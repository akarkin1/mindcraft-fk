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
const S = await loadSrc('src/agent/packs/home/shelter.js'); // leaveBuilding, as the pack context hands it on (ctx.home)
const BL = await loadSrc('src/agent/packs/breeding/breeding_logic.js'); // v0.1.4.16 FX4: the stand test of the ring

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

// v0.1.4.16 fix round (V-6): a closed house south of the pen, the house of home_fake_bot moved 14 blocks south: walls of
// planks x, z 1..7 (+14), its door in the north wall at (4, 64, 15), shut; the wall cells of the feet block every walk
// (the fake path search knows no walls but bot.blocked). The bot stands inside at (4.5, 64, 18.5).
const HOUSE_DOOR = { x: 4, y: 64, z: 15 };
function closedHouse(world, bot) {
    world.fill(1, 63, 15, 7, 63, 21, 'oak_planks');
    world.fill(1, 68, 15, 7, 68, 21, 'oak_planks');
    for (let y = 64; y <= 67; y++) {
        for (let i = 1; i <= 7; i++) {
            for (const [x, z] of [[i, 15], [i, 21], [1, 14 + i], [7, 14 + i]]) {
                world.set(x, y, z, 'oak_planks');
                if (y === 64) bot.blocked.add(`${x},64,${z}`);
            }
        }
    }
    world.door(HOUSE_DOOR.x, HOUSE_DOOR.y, HOUSE_DOOR.z, { facing: 'north', open: false });
    bot.blocked.delete(`${HOUSE_DOOR.x},64,${HOUSE_DOOR.z}`);
    return { name: 'house', type: 'home', dimension: 'overworld', source: 'scan', min: { x: 0, y: 63, z: 14 }, max: { x: 8, y: 69, z: 22 }, entrances: [{ ...HOUSE_DOOR, kind: 'door' }] };
}

/**
 * A pen with animals of a kind at the given cells, the bot south of it with the items of `bag`. Options: frozen (indices
 * of animals that never move), species, the name of the pen, babies (cells of babies at the start), chests and permits
 * (the chest index, fetchItem and the permits for takeOrAsk), stopAfterFeeds (the owner's stop after that many feeds);
 * v0.1.4.16 fix round (V-6): pos (where the order finds the bot), range (the animals of the pen are among bot.entities only
 * while the bot is within that many blocks of the pen, as the server sends the entities near a player), house (the bot in a
 * closed house south of the pen, the house saved as an area), home (ctx.home of the pack context).
 */
function pen({ species = 'cow', cells = [[0.5, 0.5], [1.5, 2.5], [3.5, 1.5], [2.5, 3.5]], babies = [], bag = { wheat: 8 }, frozen = [], name = 'cow_pen',
    type = 'pen', feed = 'wheat', chests = null, stopAfterFeeds = null, answerAt = null, pos = null, range = null, house = false, home = null,
    savedAnimals = true, fetchWalks = false } = {}) {
    const world = makeWorld();
    const bot = makeFakeBot({ world, pos: pos ?? (house ? [4.5, 64, 18.5] : [2.5, 64, 9.5]) });
    const houseArea = house ? closedHouse(world, bot) : null;
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
    const young = babies.map(([x, z]) => addMob(bot, species, [x, 64, z], { type: 'animal', metadata: { 16: true } }));
    const t = {
        world, bot, animals, said: [], logs: [], feeds: [], violations: [], positions: [], walkLines: [], maxWait: 0, fedCount: 0, gotos: [], houseArea,
    };
    // the entities the server sends: the animals of the pen only while the bot is within `range` of the pen's middle (2.5, 2.5)
    t.track = () => {
        if (range === null) return;
        const near = Math.hypot(bot.entity.position.x - 2.5, bot.entity.position.z - 2.5) <= range;
        for (const e of [...animals, ...young]) {
            if (near) bot.entities[e.id] = e;
            else delete bot.entities[e.id];
        }
    };
    t.track();
    // the walk: the straight line of the fake path search, every sample recorded; each walk with its goal and whether the
    // path search may open doors
    bot.gotoImpl = async (goal) => {
        const from = bot.entity.position.clone();
        t.gotos.push({ x: goal.x, z: goal.z, doors: bot.pathfinder.movements?.canOpenDoors === true, fed: t.feeds.length, from });
        const target = v(goal.x + 0.5, from.y, goal.z + 0.5);
        const steps = Math.max(1, Math.ceil(from.distanceTo(target) / 0.25));
        for (let i = 0; i <= steps; i++) t.walkLines.push(v(from.x + (target.x - from.x) * i / steps, from.y, from.z + (target.z - from.z) * i / steps));
        try {
            return await straightGoto(bot, goal);
        } finally {
            t.track();
        }
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
        contents: savedAnimals ? { animals: { [species]: cells.length } } : { animals: {} },
    };
    t.ctx = { areas: houseArea ? [area, houseArea] : [area], say: (text) => t.said.push(text), log: (text) => t.logs.push(text), now: t.sim.now };
    if (home) t.ctx.home = home;
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
                    if (fetchWalks) bot.entity.position = v(c.x + 0.5, 64, c.z - 0.5); // the storage pack walked to the chest
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
    // no block was clicked or opened but the door of the closed house (V-6), never the gate
    const atDoor = (c) => t.houseArea !== null && c[1] === HOUSE_DOOR.x && (c[2] === HOUSE_DOOR.y || c[2] === HOUSE_DOOR.y + 1) && c[3] === HOUSE_DOOR.z;
    assert.deepEqual(t.bot.calls.filter((c) => (c[0] === 'activate' || c[0] === 'pf_open') && !atDoor(c)), [], 'no block was clicked (the gate)');
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

// v0.1.4.16 fix round (review 6, DECISIONS V-6): to the pen first, out of a closed house through its door; the animals read
// at the ring
describe('!breed: the walk to the pen before the animals are read (V-6)', () => {
    test('ordered 60 blocks away, the cows out of the bot\'s sight: the walk to the ring (doors allowed), then the cows read and fed', async () => {
        const t = pen({ pos: [2.5, 64, 65.5], range: 32 });
        assert.ok(!t.animals.some((a) => t.bot.entities[a.id]), 'the cows are not among the entities at the order');
        const r = await t.run('cow_pen', 2);
        assert.deepEqual({ ok: r.ok, reason: r.reason, fed: r.fed, babies: r.babies }, { ok: true, reason: null, fed: 4, babies: 2 }, r.text);
        assert.equal(r.text, 'I fed 4 cows in the cow pen; 2 calves.');
        const [first, ...rest] = t.gotos;
        assert.deepEqual([first.x, first.z, first.doors, first.fed], [2, 6, true, 0], 'first the walk to the ring cell nearest the bot, the doors allowed, before any feed');
        assert.ok(first.from.z > 60, 'from where the order found the bot');
        assert.ok(rest.length > 0 && rest.every((g) => g.doors === false), 'the walks along the ring keep doors off');
        assert.ok(onOuterRing(t.bot.entity.position));
        assertOutside(t);
    });

    test('ordered inside a closed house: out through its door first (leaveBuilding of the home pack), then the ring and the feed', async () => {
        const t = pen({ house: true, home: { leaveBuilding: S.leaveBuilding } });
        const r = await t.run('cow_pen', 2);
        assert.deepEqual({ ok: r.ok, reason: r.reason, fed: r.fed, babies: r.babies }, { ok: true, reason: null, fed: 4, babies: 2 }, r.text);
        const doorClicks = t.bot.calls.map((c, i) => [c, i]).filter(([c]) => c[0] === 'activate' && c[1] === HOUSE_DOOR.x && c[3] === HOUSE_DOOR.z);
        assert.ok(doorClicks.length >= 2, 'the door opened and closed again');
        assert.equal(t.world.propsAt(HOUSE_DOOR.x, HOUSE_DOOR.y, HOUSE_DOOR.z).open, false, 'the door is shut behind the bot');
        const ringWalk = t.bot.calls.findIndex((c) => c[0] === 'goto' && c[1].z <= 6);
        assert.ok(doorClicks[0][1] < ringWalk, 'the house is left before the walk to the ring');
        assert.ok(t.logs.includes('I left "house" through the door at (4, 64, 15).'), t.logs.join(' | '));
        assert.ok(!t.bot.calls.some((c) => c[0] === 'dig'), 'never digs out');
        assertOutside(t);
    });

    test('the house cannot be left: "I could not get to the cow pen.", nothing fed', async () => {
        const left = [];
        const t = pen({ house: true, home: { leaveBuilding: async (b) => { left.push(b.entity.position.clone()); return { ok: false, area: null, reason: 'no_path', text: 'I cannot get out of "house".' }; } } });
        const r = await t.run('cow_pen', 2);
        assert.deepEqual({ ok: r.ok, reason: r.reason, text: r.text }, { ok: false, reason: 'unreached', text: 'I could not get to the cow pen.' });
        assert.equal(left.length, 1);
        assert.deepEqual(t.feeds, []);
        assert.ok(t.logs.includes(r.text));
    });

    test('a pen saved without its animals: the cows read at the ring, the wheat asked for there, the walk back from the chest to the ring', async () => {
        const chests = [{ x: 4, y: 64, z: 12, items: { wheat: 16 } }];
        const t = pen({ savedAnimals: false, bag: {}, chests, answerAt: 1000, fetchWalks: true });
        const r = await t.run('cow_pen', 2);
        assert.equal(r.text, 'I fed 4 cows in the cow pen; 2 calves.');
        assert.deepEqual(t.said.slice(0, 2), ['May I take 4 wheat from the chest at (4, 64, 12) for the feeding? Say yes or no.', 'I took 4 wheat from the chest at (4, 64, 12).']);
        const [toRing, back, ...along] = t.gotos;
        assert.deepEqual([toRing.x, toRing.z, toRing.doors], [2, 6, true], 'first to the ring, where the cows are read');
        assert.deepEqual([back.z, back.doors, Math.floor(back.from.z)], [6, true, 11], 'from the chest back to the ring');
        assert.ok(along.every((g) => g.doors === false));
        assertOutside(t);
    });

    test('no way to the pen (a river the fake path search cannot cross): "I could not get to the cow pen.", ok false, nothing fed', async () => {
        const t = pen({ pos: [2.5, 64, 65.5], range: 32 });
        for (let x = -60; x <= 60; x++) t.bot.blocked.add(`${x},64,30`);
        const r = await t.run('cow_pen', 2);
        assert.deepEqual({ ok: r.ok, reason: r.reason, text: r.text }, { ok: false, reason: 'unreached', text: 'I could not get to the cow pen.' });
        assert.deepEqual(t.feeds, []);
        assert.ok(t.gotos.length >= 1 && t.gotos.every((g) => g.doors === true && g.z === 6), 'only walks to the ring were tried');
        assert.deepEqual(t.logs, [r.text]);
    });
});

describe('!breed: the refusals (8.2)', () => {
    test('the full pen: 12 animals with the babies, the line, nothing fed, one log line; the only walk is to the ring, where they are counted', async () => {
        const cells = Array.from({ length: 10 }, (_, i) => [0.5 + (i % 5), 0.5 + Math.floor(i / 5)]);
        const t = pen({ cells, babies: [[2.5, 3.5], [3.5, 3.5]] });
        const r = await t.run('cow_pen', 2);
        assert.deepEqual({ ok: r.ok, reason: r.reason }, { ok: false, reason: 'full' });
        assert.equal(r.text, 'The cow pen is full: 12 animals; I breed no more there.');
        assert.deepEqual(t.feeds, []);
        assert.deepEqual(t.gotos.map((g) => [g.x, g.z]), [[2, 6]], 'one walk (V-6): to the ring cell nearest the bot');
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

// ---- v0.1.4.16 FX4 (review 16b, finding 1; each test fails on a96685c but the last, the guard of the refusal) ----
// A failed walk no longer refuses a pen whose ring has free cells: the cells the bot cannot stand on are skipped, up to six
// walks, a bot near the ring after the last failed walk goes on to the rounds, and a barn around the pen is no refusal.
describe('FX4 (review 16b, finding 1): the walk to the pen with blocked ring cells', () => {
    const noPath = () => Object.assign(new Error('No path to the goal!'), { name: 'NoPath' });
    const approachWalks = (t) => t.gotos.filter((g) => g.doors === true);

    test('the review\'s case: hay bales on the three ring cells nearest the bot, the rest of the ring free: the next cell, the cows fed', async () => {
        const t = pen({});
        for (const x of [1, 2, 3]) {
            t.world.set(x, 64, 6, 'hay_block');
            t.bot.blocked.add(`${x},64,6`);
        }
        const r = await t.run('cow_pen', 2);
        assert.deepEqual({ ok: r.ok, reason: r.reason, fed: r.fed, babies: r.babies }, { ok: true, reason: null, fed: 4, babies: 2 }, r.text);
        assert.equal(r.text, 'I fed 4 cows in the cow pen; 2 calves.');
        assert.deepEqual(approachWalks(t).map((g) => [g.x, g.z]), [[2, 6], [3, 6], [1, 6], [4, 6]], 'the three blocked cells, then the next one');
        assert.ok(!t.gotos.slice(4).some((g) => g.z === 6 && g.x >= 1 && g.x <= 3), 'the rounds never walk to a cell the walk could not reach');
        assert.deepEqual(t.violations, []);
        assertOutside(t);
    });

    test('a house wall along the near side (two blocks high): its cells are never walked to; the cows fed from the free cell beside it', async () => {
        const t = pen({});
        for (let x = 0; x <= 3; x++) {
            for (const y of [64, 65]) t.world.set(x, y, 6, 'oak_planks');
            t.bot.blocked.add(`${x},64,6`);
        }
        const r = await t.run('cow_pen', 1);
        assert.deepEqual({ ok: r.ok, reason: r.reason, fed: r.fed, babies: r.babies }, { ok: true, reason: null, fed: 2, babies: 1 }, r.text);
        assert.ok(!t.gotos.some((g) => g.z === 6 && g.x >= 0 && g.x <= 3), `no walk into the wall: ${JSON.stringify(t.gotos.map((g) => [g.x, g.z]))}`);
        assert.deepEqual(approachWalks(t).map((g) => [g.x, g.z]), [[4, 6]], 'one walk to the pen: the nearest cell the bot can stand on');
        assertOutside(t);
    });

    test('water and a neighbouring pen\'s fence on the ring are skipped too; a hay bale is a cell to stand on (one block up)', () => {
        const blocks = new Map();
        const get = (x, y, z) => blocks.get(`${x},${y},${z}`) ?? (y <= 63 ? { name: 'grass_block', solid: true } : { name: 'air', solid: false });
        const fenceBox = { min: { x: -1, y: 62, z: -1 }, max: { x: 5, y: 66, z: 5 } };
        for (let x = -1; x <= 5; x++) blocks.set(`${x},64,5`, { name: 'oak_fence', solid: true });
        blocks.set('2,63,6', { name: 'water', solid: false });
        blocks.set('3,64,6', { name: 'spruce_fence', solid: true });
        blocks.set('4,64,6', { name: 'hay_block', solid: true });
        blocks.set('0,65,6', { name: 'hay_block', solid: true }); // at head height: the bot cannot stand under it
        assert.equal(BL.fenceFootY(get, fenceBox, { x: 2, z: 6 }), 64, 'the feet beside the fence');
        assert.equal(BL.ringCellStandable(get, fenceBox, { x: 1, z: 6 }), true, 'grass under, air above');
        assert.equal(BL.ringCellStandable(get, fenceBox, { x: 2, z: 6 }), false, 'water');
        assert.equal(BL.ringCellStandable(get, fenceBox, { x: 3, z: 6 }), false, 'a fence: never stood in or on');
        assert.equal(BL.ringCellStandable(get, fenceBox, { x: 4, z: 6 }), true, 'on the hay bale');
        assert.equal(BL.ringCellStandable(get, fenceBox, { x: 0, z: 6 }), false, 'under a hay bale');
        assert.equal(BL.standableAt(get, { x: 1, z: 6 }, 64), true);
        assert.equal(BL.standableAt(() => null, { x: 1, z: 6 }, 64), null, 'not loaded: not known');
        assert.equal(BL.ringCellStandable(() => null, fenceBox, { x: 1, z: 6 }), true, 'not known: the walk tries it');
        blocks.set('1,64,6', { name: 'oak_slab', solid: false, properties: { waterlogged: true } });
        assert.equal(BL.standableAt(get, { x: 1, z: 6 }, 64), false, 'a waterlogged block is a liquid');
    });

    test('every walk fails and ends near the ring (2 blocks off the cell): the rounds go on and feed', async () => {
        const t = pen({ pos: [2.5, 64, 20.5] });
        const walk = t.bot.gotoImpl;
        t.bot.gotoImpl = async (goal) => {
            if (t.bot.pathfinder.movements?.canOpenDoors !== true) return walk(goal);
            t.gotos.push({ x: goal.x, z: goal.z, doors: true, fed: t.feeds.length, from: t.bot.entity.position.clone() });
            t.bot.entity.position = v(goal.x + 0.5, 64, goal.z + 2.5); // the path search gave up two blocks short
            throw noPath();
        };
        const r = await t.run('cow_pen', 1);
        assert.equal(approachWalks(t).length, 6, 'six walks to the pen');
        assert.deepEqual({ ok: r.ok, reason: r.reason, fed: r.fed, babies: r.babies }, { ok: true, reason: null, fed: 2, babies: 1 }, r.text);
        assertOutside(t);
    });

    test('no way at all (the river): six walks, then "I could not get to the cow pen."', async () => {
        const t = pen({ pos: [2.5, 64, 65.5], range: 32 });
        for (let x = -60; x <= 60; x++) t.bot.blocked.add(`${x},64,30`);
        const r = await t.run('cow_pen', 2);
        assert.deepEqual({ ok: r.ok, reason: r.reason, text: r.text }, { ok: false, reason: 'unreached', text: 'I could not get to the cow pen.' });
        assert.equal(t.gotos.length, 6, 'at most six walks');
        assert.deepEqual(t.feeds, []);
    });

    // A barn: a saved building whose box holds the pen and the bot; its door cannot be passed (leaveBuilding fails).
    const BARN = { name: 'barn', type: 'building', dimension: 'overworld', source: 'scan', min: { x: -6, y: 63, z: -6 }, max: { x: 10, y: 70, z: 12 }, entrances: [] };

    test('ordered in a barn around the pen: leaveBuilding fails, the pen lies in the barn\'s box: on to the ring, the cows fed', async () => {
        for (const area of [BARN, null]) {
            const left = [];
            const t = pen({ home: { leaveBuilding: async () => { left.push(1); return { ok: false, area, reason: 'no_entrance', text: 'I cannot get out of "barn".' }; } } });
            t.ctx.areas.push(BARN);
            const r = await t.run('cow_pen', 2);
            assert.deepEqual({ ok: r.ok, reason: r.reason, fed: r.fed, babies: r.babies }, { ok: true, reason: null, fed: 4, babies: 2 }, `${area ? 'the area given' : 'the area found'}: ${r.text}`);
            assert.equal(left.length, 1);
            assertOutside(t);
        }
    });

    test('a barn that does not hold the pen (the pen beside it): the refusal stays', async () => {
        const shed = { ...BARN, name: 'shed', min: { x: 0, y: 63, z: 8 }, max: { x: 8, y: 70, z: 12 } };
        const t = pen({ home: { leaveBuilding: async () => ({ ok: false, area: shed, reason: 'no_entrance', text: 'I cannot get out of "shed".' }) } });
        t.ctx.areas.push(shed);
        const r = await t.run('cow_pen', 2);
        assert.deepEqual({ ok: r.ok, reason: r.reason, text: r.text }, { ok: false, reason: 'unreached', text: 'I could not get to the cow pen.' });
        assert.deepEqual(t.gotos, [], 'no walk');
    });
});
