// Spec v0.1.4.16, 8.2 (E6): !breed (src/agent/packs/breeding/breeding.js) on the fake bot of the home pack: a pen 5 x 5 with a
// fence ring and a closed gate, cows that walk to the held wheat (inside the fence) and breed two seconds after two of them
// are in love, a game server that refuses a feed beyond 3 blocks of the eyes. The walk to the ring outside the fence, the
// feeds with activateEntity on the nearest adults, never a cell inside the box, the gate never clicked, nothing placed, the
// texts; the full pen; the unknown species, pen and feed; the feed from a known chest with the owner's word; the cooldown
// between rounds (the stop looked at every 500 ms); an animal out of reach skipped; the owner's stop.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { addMob, give, makeFakeBot, makeSim, makeWorld, straightGoto, v } from './home_fake_bot.test.js';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';

const B = await loadSrc('src/agent/packs/breeding/breeding.js');
const P = await loadSrc('src/agent/world/stock_permits.js');

// The fence ring at y 64 on x -1..5, z -1..5 (the ground of the pen x 0..4, z 0..4), the gate at (2, 64, -1); the saved box
// holds the fence, as the survey and scanPen save a pen.
const FENCE = { min: { x: -1, z: -1 }, max: { x: 5, z: 5 } };
const GATE = { x: 2, y: 64, z: -1 };
const insideFence = (p) => Math.floor(p.x) >= FENCE.min.x && Math.floor(p.x) <= FENCE.max.x && Math.floor(p.z) >= FENCE.min.z && Math.floor(p.z) <= FENCE.max.z;
const onOuterRing = (p) => !insideFence(p) && Math.floor(p.x) >= -2 && Math.floor(p.x) <= 6 && Math.floor(p.z) >= -2 && Math.floor(p.z) <= 6;

let cap;
beforeEach(() => {
    cap = captureConsole();
});
afterEach(() => cap.restore());

/**
 * A pen with animals of a kind at the given cells, the bot south of it with the items of `bag`. Options: frozen (indices
 * of animals that never move), species, the name of the pen, babies (cells of babies at the start), chests and permits
 * (the chest index, fetchItem and the permits for takeOrAsk), stopAfterFeeds (the owner's stop after that many feeds).
 */
function pen({ species = 'cow', cells = [[0.5, 0.5], [1.5, 2.5], [3.5, 1.5], [2.5, 3.5]], babies = [], bag = { wheat: 8 }, frozen = [], name = 'cow_pen',
    type = 'pen', feed = 'wheat', chests = null, stopAfterFeeds = null, answerAt = null } = {}) {
    const world = makeWorld();
    const bot = makeFakeBot({ world, pos: [2.5, 64, 9.5] });
    for (let x = -1; x <= 5; x++) {
        for (let z = -1; z <= 5; z++) {
            if (x !== -1 && x !== 5 && z !== -1 && z !== 5) continue;
            if (x === GATE.x && z === GATE.z) {
                world.gate(GATE.x, GATE.y, GATE.z, { facing: 'north' });
                continue;
            }
            world.set(x, 64, z, 'oak_fence');
            bot.blocked.add(`${x},64,${z}`);
        }
    }
    for (const [item, n] of Object.entries(bag)) give(bot, item, n);
    const animals = cells.map(([x, z], i) => Object.assign(addMob(bot, species, [x, 64, z], { type: 'animal' }), { frozen: frozen.includes(i) }));
    for (const [x, z] of babies) addMob(bot, species, [x, 64, z], { type: 'animal', metadata: { 16: true } });
    const t = {
        world, bot, animals, said: [], logs: [], feeds: [], violations: [], positions: [], walkLines: [], maxWait: 0, fedCount: 0,
    };
    // the walk: the straight line of the fake path search, every sample recorded
    bot.gotoImpl = async (goal) => {
        const from = bot.entity.position.clone();
        const target = v(goal.x + 0.5, from.y, goal.z + 0.5);
        const steps = Math.max(1, Math.ceil(from.distanceTo(target) / 0.25));
        for (let i = 0; i <= steps; i++) t.walkLines.push(v(from.x + (target.x - from.x) * i / steps, from.y, from.z + (target.z - from.z) * i / steps));
        return straightGoto(bot, goal);
    };
    // the game: a feed within 3 blocks of the eyes puts an adult that is not in love or in its cooldown in love
    bot.activateEntity = async (entity) => {
        const eyes = bot.entity.position.offset(0, 1.62, 0);
        const d = eyes.distanceTo(entity.position.offset(0, 0.5, 0));
        const others = Object.values(bot.entities).filter((e) => e.name === species && e !== entity && !e.metadata?.[16] && !e.loveAt && !(e.cooldownUntil > t.sim.t)
            && !t.feeds.some((f) => f.id === e.id && t.sim.t - f.at < 300000))
            .map((e) => eyes.distanceTo(e.position.offset(0, 0.5, 0)));
        t.feeds.push({ id: entity.id, at: t.sim.t, d, nearest: others.every((o) => d <= o + 1e-9), held: bot.heldItem?.name ?? null });
        if (d > 3) {
            t.violations.push(`feed at ${d.toFixed(2)} blocks`);
            return;
        }
        const held = bot.heldItem;
        if (held?.name === feed && held.count > 0 && entity.name === species && !entity.metadata?.[16] && !entity.loveAt && !(entity.cooldownUntil > t.sim.t)) {
            held.count--;
            entity.loveAt = t.sim.t;
            t.fedCount++;
        }
    };
    let last = null;
    t.sim = makeSim(bot, {
        onStep(sim) {
            const dt = last === null ? 0.05 : (sim.t - last) / 1000;
            last = sim.t;
            t.positions.push(bot.entity.position.clone());
            if (stopAfterFeeds !== null && t.fedCount >= stopAfterFeeds) bot.interrupt_code = true;
            const holding = bot.heldItem?.name === feed && bot.heldItem.count > 0;
            for (const e of Object.values(bot.entities)) {
                if (e.name !== species || e.frozen || !holding) continue;
                const dx = bot.entity.position.x - e.position.x;
                const dz = bot.entity.position.z - e.position.z;
                const len = Math.hypot(dx, dz);
                if (len < 1e-6) continue;
                const step = Math.min(len, 1.0 * dt);
                const clamp = (a) => Math.min(4.7, Math.max(0.3, a));
                e.position = v(clamp(e.position.x + dx / len * step), 64, clamp(e.position.z + dz / len * step));
            }
            const lovers = Object.values(bot.entities).filter((e) => e.loveAt && sim.t - e.loveAt >= 2000);
            if (lovers.length >= 2) {
                const [a, b] = lovers;
                addMob(bot, species, [a.position.x, 64, a.position.z], { type: 'animal', metadata: { 16: true } });
                for (const p of [a, b]) {
                    p.loveAt = null;
                    p.cooldownUntil = sim.t + 300000;
                }
            }
            if (answerAt !== null && sim.t - t.start >= answerAt && t.permits && !t.answered) {
                t.answered = true;
                t.permits.set(feed, true); // the owner's "yes": !allowTaking(feed, true)
            }
        },
    });
    t.start = t.sim.t;
    const wait = t.sim.wait;
    t.wait = async (ms) => {
        t.maxWait = Math.max(t.maxWait, ms);
        await wait(ms);
    };
    const area = {
        name, type, kind: type, dimension: 'overworld', source: 'survey',
        min: { x: -1, y: 62, z: -1 }, max: { x: 5, y: 66, z: 5 }, entrances: [{ ...GATE, kind: 'gate' }],
        contents: { animals: { [species]: cells.length } },
    };
    t.ctx = { areas: [area], say: (text) => t.said.push(text), log: (text) => t.logs.push(text), now: t.sim.now };
    if (chests) {
        t.permits = new P.StockPermits(null, { now: t.sim.now });
        t.fetches = [];
        Object.assign(t.ctx, {
            permits: t.permits,
            chests: { find: (item) => chests.filter((c) => (c.items[item] ?? 0) > 0).map((c) => ({ ...c, items: { ...c.items } })) },
            storage: {
                async fetchItem(item, count) {
                    t.fetches.push([item, count]);
                    const c = chests.find((x) => (x.items[item] ?? 0) >= count);
                    if (!c) return { ok: false, reason: 'no_more', taken: 0, chests: [], text: 'none' };
                    c.items[item] -= count;
                    give(bot, item, count);
                    return { ok: true, reason: null, taken: count, chests: [{ x: c.x, y: c.y, z: c.z }], text: 'fetched' };
                },
            },
        });
    }
    t.run = (penName = name, count = 2) => B.breed(bot, t.ctx, penName, count, { now: t.sim.now, wait: t.wait });
    t.bagOf = (item) => bot.inventory.list.filter((i) => i.name === item).reduce((s, i) => s + i.count, 0);
    return t;
}

function assertOutside(t) {
    for (const p of [...t.positions, ...t.walkLines]) assert.ok(!insideFence(p), `the bot at (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) is inside the pen`);
    assert.ok(!t.bot.calls.some((c) => c[0] === 'activate'), 'no block was clicked (the gate)');
    assert.notEqual(t.world.propsAt(GATE.x, GATE.y, GATE.z).open, true, 'the gate stays closed');
    assert.ok(!t.bot.calls.some((c) => c[0] === 'place' || c[0] === 'dig'), 'nothing placed or dug');
    assert.equal(t.bot.pathfinder.movements?.canOpenDoors, false, 'the walk may not open gates');
}

describe('!breed: the pen of 4 cows (8.2)', () => {
    test('the walk to the ring outside the fence, feeds with activateEntity on the nearest adults, two pairs, two calves, the lines', async () => {
        const t = pen();
        const r = await t.run('cow_pen', 2);
        assert.deepEqual({ ok: r.ok, reason: r.reason, fed: r.fed, babies: r.babies }, { ok: true, reason: null, fed: 4, babies: 2 });
        assert.equal(r.text, 'I fed 4 cows in the cow pen; 2 calves.');
        assert.deepEqual(t.said, ['I fed 2 cows in the cow pen.', 'I fed 2 cows in the cow pen.']);
        assert.equal(t.feeds.length, 4);
        assert.equal(new Set(t.feeds.map((f) => f.id)).size, 4, 'four different adults');
        assert.ok(t.feeds.every((f) => f.nearest), 'each feed on the nearest adult that may be fed');
        assert.ok(t.feeds.every((f) => f.held === 'wheat'), 'the wheat in hand');
        assert.deepEqual(t.violations, [], 'every feed within reach');
        assert.equal(t.bagOf('wheat'), 4, 'two per pair');
        assert.ok(t.bot.calls.some((c) => c[0] === 'equip' && c[1] === 'wheat' && c[2] === 'hand'));
        assert.ok(onOuterRing(t.bot.entity.position), `the bot stands on the ring outside the fence: ${t.bot.entity.position}`);
        assertOutside(t);
    });

    test('count 1: one pair, one calf; the young of other species have their words', async () => {
        const t = pen();
        const r = await t.run('cow_pen', 1);
        assert.equal(r.text, 'I fed 2 cows in the cow pen; 1 calf.');
        assert.equal(t.bagOf('wheat'), 6);
        const sheep = pen({ species: 'sheep', name: 'sheep_pen' });
        assert.equal((await sheep.run('sheep_pen', 1)).text, 'I fed 2 sheep in the sheep pen; 1 lamb.');
        const chickens = pen({ species: 'chicken', name: 'coop', bag: { wheat_seeds: 8 }, feed: 'wheat_seeds' });
        assert.equal((await chickens.run('coop', 1)).text, 'I fed 2 chickens in the coop; 1 chick.');
    });

    test('the pen by its name in words; the babies at the start are no parents and no new young', async () => {
        const t = pen({ babies: [[1.5, 1.5]] });
        const r = await t.run('Cow Pen', 1);
        assert.equal(r.text, 'I fed 2 cows in the cow pen; 1 calf.');
        assert.equal(r.babies, 1);
    });
});

describe('!breed: the refusals (8.2)', () => {
    test('the full pen: 12 animals with the babies, the line, nothing walked or fed, one log line', async () => {
        const cells = Array.from({ length: 10 }, (_, i) => [0.5 + (i % 5), 0.5 + Math.floor(i / 5)]);
        const t = pen({ cells, babies: [[2.5, 3.5], [3.5, 3.5]] });
        const r = await t.run('cow_pen', 2);
        assert.deepEqual({ ok: r.ok, reason: r.reason }, { ok: false, reason: 'full' });
        assert.equal(r.text, 'The cow pen is full: 12 animals; I breed no more there.');
        assert.deepEqual(t.feeds, []);
        assert.ok(!t.bot.calls.some((c) => c[0] === 'goto'));
        assert.equal(t.bagOf('wheat'), 8);
        assert.deepEqual(t.logs, [r.text]);
    });

    test('the unknown species: the horses', async () => {
        const t = pen({ species: 'horse', name: 'stable' });
        const r = await t.run('stable', 2);
        assert.equal(r.reason, 'unknown_species');
        assert.equal(r.text, 'I do not know what the horses eat; I breed cows, sheep, pigs, chickens and rabbits.');
        assert.deepEqual(t.feeds, []);
    });

    test('an unknown pen, and a farm is no pen', async () => {
        const t = pen();
        assert.equal((await t.run('barn', 2)).text, 'I know no pen "barn".');
        const farm = pen({ type: 'farm', name: 'wheat_farm' });
        assert.equal((await farm.run('wheat_farm', 2)).reason, 'unknown_pen');
    });

    test('no feed in the bag and no chest: the line of no feed', async () => {
        const t = pen({ bag: {} });
        const r = await t.run('cow_pen', 2);
        assert.deepEqual({ reason: r.reason, text: r.text }, { reason: 'no_feed', text: 'I have no wheat for the cows.' });
        assert.deepEqual(t.feeds, []);
    });
});

describe('!breed: the feed from a known chest (8.1, the W134 C case)', () => {
    test('no carrot in the bag, carrots in a chest, no permit: the question, the owner\'s yes, the took-line, the feed', async () => {
        const chests = [{ x: 4, y: 64, z: 12, items: { carrot: 16 } }];
        const t = pen({ species: 'pig', name: 'pig_pen', bag: {}, feed: 'carrot', chests, answerAt: 5000 });
        const r = await t.run('pig_pen', 1);
        assert.equal(t.said[0], 'May I take 2 carrot from the chest at (4, 64, 12) for the feeding? Say yes or no.');
        assert.equal(t.said[1], 'I took 2 carrot from the chest at (4, 64, 12).');
        assert.equal(t.said[2], 'I fed 2 pigs in the pig pen.');
        assert.equal(r.text, 'I fed 2 pigs in the pig pen; 1 piglet.');
        assert.deepEqual(t.fetches, [['carrot', 2]]);
        assert.equal(chests[0].items.carrot, 14);
        assert.equal(t.permits.may('carrot'), true);
        assertOutside(t);
    });

    test('no word within 60 s: the refusal, nothing taken, nothing fed', async () => {
        const chests = [{ x: 4, y: 64, z: 12, items: { carrot: 16 } }];
        const t = pen({ species: 'pig', name: 'pig_pen', bag: {}, feed: 'carrot', chests });
        const r = await t.run('pig_pen', 1);
        assert.deepEqual({ reason: r.reason, text: r.text }, { reason: 'no_permit', text: 'I take no carrot without your word; say "you may take carrot" when you want.' });
        assert.deepEqual(t.fetches, []);
        assert.deepEqual(t.feeds, []);
    });

    test('with no carrot in the chests but potatoes: the pigs\' other feed is asked for', async () => {
        const chests = [{ x: 4, y: 64, z: 12, items: { potato: 10 } }];
        const t = pen({ species: 'pig', name: 'pig_pen', bag: {}, feed: 'potato', chests, answerAt: 1000 });
        const r = await t.run('pig_pen', 1);
        assert.equal(t.said[0], 'May I take 2 potato from the chest at (4, 64, 12) for the feeding? Say yes or no.');
        assert.equal(r.text, 'I fed 2 pigs in the pig pen; 1 piglet.');
    });
});

describe('!breed: the pace (8.2)', () => {
    test('two adults, count 2: a pair, the cooldown of 5 minutes, the same pair again; no wait longer than 500 ms', async () => {
        const t = pen({ cells: [[1.5, 3.5], [3.5, 3.5]] });
        const r = await t.run('cow_pen', 2);
        assert.equal(r.text, 'I fed 4 cows in the cow pen; 2 calves.');
        const [first, , third] = t.feeds;
        assert.ok(third.at - first.at >= 300000, `the second round after the cooldown (${third.at - first.at} ms)`);
        assert.ok(t.maxWait <= 500, `the longest wait ${t.maxWait} ms: a stop is seen within 500 ms (the action manager kills after 10 s)`);
        assertOutside(t);
    });

    test('an adult that never comes within reach is skipped; the others are fed', async () => {
        const t = pen({ cells: [[2.5, 2.5], [1.5, 3.5], [3.5, 3.5], [2.5, 4.5]], frozen: [0] });
        const r = await t.run('cow_pen', 1);
        assert.equal(r.text, 'I fed 2 cows in the cow pen; 1 calf.');
        assert.ok(!t.feeds.some((f) => f.id === t.animals[0].id), 'the cow in the middle was never clicked');
        assert.deepEqual(t.violations, []);
    });

    test('the owner\'s stop after the first pair: the stop line, one log line', async () => {
        const t = pen({ stopAfterFeeds: 2 });
        const r = await t.run('cow_pen', 2);
        assert.deepEqual({ ok: r.ok, reason: r.reason }, { ok: false, reason: 'interrupted' });
        assert.equal(r.text, 'I stopped the feeding at the cow pen: 2 cows fed, 0 calves.');
        assert.ok(t.logs.includes(r.text));
        assert.equal(t.feeds.length, 2);
    });
});
