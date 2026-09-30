// Spec v0.1.4.9, part A (engineer E1): the hook of I5 in the home pack. When the path search finds no way,
// sleepInBed and goToShelter ask ctx.routes.walkTo; when it arrives, the walk goes on as if the path search
// had; when it fails with a reason other than no_route, its text replaces the text of the failure; without
// ctx.routes nothing changes. The fake bot of home_fake_bot.test.js; ctx.routes is a fake.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeFakeBot, buildHouse, v } from './home_fake_bot.test.js';

const Z = await loadSrc('src/agent/packs/home/sleep.js');
const S = await loadSrc('src/agent/packs/home/shelter.js');
const L = await loadSrc('src/agent/packs/home/shelter_logic.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

const QUICK = { checkMs: 40, wait: () => new Promise(r => setTimeout(r, 2)) };
const BROKEN = 'I could not follow the route "bed" at step 2 of 3, at (9, 64, 10). Show me the way again.';

// A fake ctx.routes: walkTo records its calls and answers `answer`; `moveTo` puts the bot there first.
function fakeRoutes(bot, answer, moveTo = null) {
    const calls = [];
    return {
        calls,
        walkTo: async (b, target, options) => {
            calls.push({ b, target, options });
            if (moveTo) bot.entity.position = v(...moveTo);
            return answer;
        },
    };
}

describe('I5 in sleepInBed', () => {
    function scene() {
        const world = makeWorld();
        world.bed(20, 64, 10, { facing: 'east' });
        const bot = makeFakeBot({ world, pos: [5.5, 64, 10.5] });
        bot.time.timeOfDay = 13000;
        bot.sleepMs = 0;
        bot.blocked.add('12,64,10'); // the path search finds no way to the bed
        const ctx = { areas: [], places: null, settings: {}, log: () => {}, now: () => Date.now() };
        return { world, bot, ctx };
    }

    test('without ctx.routes: as in v0.1.4.8', async () => {
        const s = scene();
        const r = await Z.sleepInBed(s.bot, s.ctx, QUICK);
        assert.deepEqual({ reason: r.reason, text: r.text }, { reason: 'no_path', text: 'I could not sleep: I found no way to the bed.' });
    });

    test('the route arrives: the bot sleeps; walkTo got the bed and the clock', async () => {
        const s = scene();
        s.ctx.routes = fakeRoutes(s.bot, { ok: true, reason: null, text: 'I followed the route "bed", 3 steps.', route: 'bed' }, [19.5, 64, 10.5]);
        const r = await Z.sleepInBed(s.bot, s.ctx, QUICK);
        assert.equal(r.text, 'I slept. It is morning.');
        assert.equal(s.ctx.routes.calls.length, 1);
        const call = s.ctx.routes.calls[0];
        assert.deepEqual({ x: call.target.x, y: call.target.y, z: call.target.z }, { x: 21, y: 64, z: 10 }, 'the head of the bed');
        assert.equal(typeof call.options.clock?.now, 'function');
    });

    test('the route fails: its text replaces the text of the failure', async () => {
        const s = scene();
        s.ctx.routes = fakeRoutes(s.bot, { ok: false, reason: 'no_path', text: BROKEN, route: 'bed' });
        const r = await Z.sleepInBed(s.bot, s.ctx, QUICK);
        assert.deepEqual({ ok: r.ok, reason: r.reason, text: r.text }, { ok: false, reason: 'no_path', text: BROKEN });
    });

    test('no route: the text of v0.1.4.8', async () => {
        const s = scene();
        s.ctx.routes = fakeRoutes(s.bot, { ok: false, reason: 'no_route', text: '', route: null });
        const r = await Z.sleepInBed(s.bot, s.ctx, QUICK);
        assert.equal(r.text, 'I could not sleep: I found no way to the bed.');
    });

    test('stopped on the route: interrupted, with the text of the route', async () => {
        const s = scene();
        s.ctx.routes = fakeRoutes(s.bot, { ok: false, reason: 'interrupted', text: 'I was stopped on the route "bed" at step 1 of 3.', route: 'bed' });
        const r = await Z.sleepInBed(s.bot, s.ctx, QUICK);
        assert.deepEqual({ reason: r.reason, text: r.text }, { reason: 'interrupted', text: 'I was stopped on the route "bed" at step 1 of 3.' });
    });
});

describe('I5 in goToShelter', () => {
    test('the place "home": the route before any digging; it arrives', async () => {
        const world = makeWorld();
        const bot = makeFakeBot({ world, pos: [30.5, 64, 30.5] });
        bot.blocked.add('20,64,20');
        const places = { recall: n => (n === 'home' ? { x: 10, y: 64, z: 10 } : undefined) };
        const ctx = { areas: [], places, settings: {}, log: () => {}, now: () => Date.now() };
        ctx.routes = fakeRoutes(bot, { ok: true, reason: null, text: 'x', route: 'home' }, [10.5, 64, 10.5]);
        let digWalks = 0;
        const inner = bot.gotoImpl;
        bot.gotoImpl = async (goal) => {
            if (bot.pathfinder.movements?.canDig) digWalks++;
            return inner(goal);
        };
        const r = await S.goToShelter(bot, ctx, QUICK);
        assert.deepEqual({ ok: r.ok, text: r.text }, { ok: true, text: 'I am at the place "home". I know no building around it.' });
        assert.deepEqual(ctx.routes.calls.map(c => c.target), [{ x: 10, y: 64, z: 10 }]);
        assert.equal(digWalks, 0);
    });

    test('the place "home": a broken route digs nothing and says its text; no route digs as before', async () => {
        const run = async (answer) => {
            const world = makeWorld();
            const bot = makeFakeBot({ world, pos: [30.5, 64, 30.5] });
            bot.blocked.add('20,64,20');
            const places = { recall: n => (n === 'home' ? { x: 10, y: 64, z: 10 } : undefined) };
            const ctx = { areas: [], places, settings: {}, log: () => {}, now: () => Date.now(), routes: fakeRoutes(bot, answer) };
            const digWalks = [];
            const inner = bot.gotoImpl;
            bot.gotoImpl = async (goal) => {
                if (bot.pathfinder.movements?.canDig) digWalks.push(goal);
                return inner(goal);
            };
            return { r: await S.goToShelter(bot, ctx, QUICK), digWalks };
        };
        const broken = await run({ ok: false, reason: 'no_path', text: BROKEN, route: 'home' });
        assert.deepEqual({ ok: broken.r.ok, reason: broken.r.reason, text: broken.r.text }, { ok: false, reason: 'no_path', text: BROKEN });
        assert.equal(broken.digWalks.length, 0);
        const none = await run({ ok: false, reason: 'no_route', text: '', route: null });
        assert.equal(none.r.text, 'I could not get to the place "home".');
        assert.equal(none.digWalks.length, 1, 'the walk with digging of v0.1.4.8');
    });

    test('the area home: the path search finds no way to the door, the route brings the bot inside', async () => {
        const world = makeWorld();
        const house = buildHouse(world);
        const bot = makeFakeBot({ world, pos: [4.5, 64, 30.5] });
        bot.blocked.add('4,64,20');
        const ctx = { areas: [house], places: null, settings: {}, log: () => {}, now: () => Date.now() };
        ctx.routes = fakeRoutes(bot, { ok: true, reason: null, text: 'x', route: 'home' }, [4.5, 64, 4.5]);
        const r = await S.goToShelter(bot, ctx, QUICK);
        assert.deepEqual({ ok: r.ok, where: r.where, text: r.text }, { ok: true, where: 'home', text: 'I am in the shelter "home". The door is closed.' });
        assert.equal(ctx.routes.calls.length, 1);
        assert.deepEqual(ctx.routes.calls[0].target.min, house.min, 'the area is the target');
        assert.equal(L.isInsideArea(house, bot.entity.position), true);
    });

    test('the area home: a broken route gives its text; without ctx.routes the text of v0.1.4.8', async () => {
        const run = async (routes) => {
            const world = makeWorld();
            const house = buildHouse(world);
            const bot = makeFakeBot({ world, pos: [4.5, 64, 30.5] });
            bot.blocked.add('4,64,20');
            const ctx = { areas: [house], places: null, settings: {}, log: () => {}, now: () => Date.now(), routes: routes?.(bot) ?? null };
            return await S.goToShelter(bot, ctx, QUICK);
        };
        const broken = await run(bot => fakeRoutes(bot, { ok: false, reason: 'no_path', text: BROKEN, route: 'home' }));
        assert.deepEqual({ ok: broken.ok, reason: broken.reason, text: broken.text }, { ok: false, reason: 'no_path', text: BROKEN });
        const off = await run(null);
        assert.equal(off.reason, 'no_path');
        assert.match(off.text, /^I cannot get into the shelter "home"\./);
    });
});
