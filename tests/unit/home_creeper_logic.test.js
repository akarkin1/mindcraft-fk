// Spec v0.1.4.6 H6: src/agent/packs/home/creeper_logic.js -- decide(state), the creeper procedure as
// pure geometry. The owner: never go for the shelter with a creeper near; lure it away first, then run.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const C = await loadSrc('src/agent/packs/home/creeper_logic.js');
const G = await loadSrc('src/agent/packs/home/box_math.js');

const HELP = 'A creeper keeps following me near the base. I stay away from the buildings. Can you help?';

const box = (name, x1, z1, x2, z2, type = 'building') => ({ name, type, min: { x: x1, y: 63, z: z1 }, max: { x: x2, y: 69, z: z2 } });
// A scanned house: blocks from 1..7, the box grown by one. Its south door is at (4, 64, 7).
const HOUSE = box('home', 0, 0, 8, 8);
const p = (x, z, y = 64) => ({ x, y, z });
const creeper = (x, z, extra = {}) => ({ id: extra.id ?? 7, pos: p(x, z), fuse: extra.fuse ?? false });

function state(over = {}) {
    return { botPos: p(4.5, 12.5), creepers: [], areas: [HOUSE], fighting: false, canFight: false, tries: 0, fuseBurning: false, now: 1000, ...over };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const insideAny = (areas, pos) => areas.some(a => G.containsPos(a, pos));
const minAreaDist = (areas, pos) => Math.min(...areas.map(a => G.distanceToBox(a, pos)));

describe('decide: none', () => {
    test('no creepers', () => {
        const d = C.decide(state());
        assert.equal(d.step, 'none');
        assert.equal(d.moveTo, null);
        assert.equal(d.creeper, null);
        assert.equal(d.text, null);
    });

    test('a creeper farther than 16 from the bot and from every area near the bot', () => {
        const d = C.decide(state({ botPos: p(40, 40), creepers: [creeper(40, 57.5)] }));
        assert.equal(d.step, 'none');
    });

    test('a creeper near an area that is more than 32 blocks from the bot does not count', () => {
        const d = C.decide(state({ botPos: p(60, 60), creepers: [creeper(4, 14)] }));
        assert.equal(d.step, 'none');
    });

    test('bad state: none, no throw', () => {
        assert.equal(C.decide(null).step, 'none');
        assert.equal(C.decide({}).step, 'none');
        assert.equal(C.decide(state({ creepers: 'x', areas: null })).step, 'none');
        assert.equal(C.decide(state({ creepers: [null, { id: 1, pos: { x: NaN, y: 0, z: 0 } }] })).step, 'none');
    });

    test('the bot inside a closed building with the creeper outside stays: none', () => {
        const d = C.decide(state({ botPos: p(4.5, 4.5), creepers: [creeper(4.5, 11)] }));
        assert.equal(d.step, 'none');
        assert.equal(d.reason, 'in_shelter');
        const near = C.decide(state({ botPos: p(4.5, 5.5), creepers: [creeper(4.5, 9.5)] }));
        assert.equal(near.step, 'none', 'even within 5 blocks, the wall is between');
    });

    test('a creeper inside the building with the bot is handled', () => {
        const d = C.decide(state({ botPos: p(3.5, 3.5), creepers: [creeper(5.5, 5.5)] }));
        assert.equal(d.step, 'back_off');
    });

    test('a farm does not count as shelter', () => {
        const farm = box('field', 0, 0, 8, 8, 'farm');
        const d = C.decide(state({ areas: [farm], botPos: p(4.5, 4.5), creepers: [creeper(4.5, 11)] }));
        assert.notEqual(d.step, 'none');
    });
});

describe('decide: back_off wins over everything', () => {
    test('a creeper within 5 blocks: 12 blocks straight away, sprinting', () => {
        const bot = p(20, 20);
        const c = creeper(20, 16);
        const d = C.decide(state({ botPos: bot, creepers: [c], areas: [] }));
        assert.equal(d.step, 'back_off');
        assert.equal(d.sprint, true);
        assert.equal(d.creeper, 7);
        assert.ok(Math.abs(d.moveTo.x - 20) < 1e-9 && Math.abs(d.moveTo.z - 32) < 1e-9, JSON.stringify(d.moveTo));
        assert.equal(d.moveTo.y, 64);
    });

    test('a burning fuse at 8 blocks', () => {
        const d = C.decide(state({ botPos: p(30, 30), areas: [], creepers: [creeper(30, 38, { fuse: true })] }));
        assert.equal(d.step, 'back_off');
        assert.equal(d.reason, 'fuse');
        assert.ok(d.moveTo.z < 30);
    });

    test('fuse as the number 1 of the metadata counts, -1 does not', () => {
        assert.equal(C.decide(state({ botPos: p(30, 30), areas: [], creepers: [creeper(30, 38, { fuse: 1 })] })).step, 'back_off');
        assert.equal(C.decide(state({ botPos: p(30, 30), areas: [], creepers: [creeper(30, 38, { fuse: -1 })] })).step, 'run');
    });

    test('fuseBurning of the state backs off from the nearest creeper', () => {
        const d = C.decide(state({ botPos: p(30, 30), areas: [], fuseBurning: true, creepers: [creeper(30, 40, { id: 1 }), creeper(38, 30, { id: 2 })] }));
        assert.equal(d.step, 'back_off');
        assert.equal(d.creeper, 2);
    });

    test('back_off wins over help, lure and fight', () => {
        const d = C.decide(state({ tries: 5, fighting: true, canFight: true, botPos: p(4.5, 12.5), creepers: [creeper(4.5, 16)] }));
        assert.equal(d.step, 'back_off');
    });

    test('two creepers: away from the nearest, the distance to it grows', () => {
        const bot = p(20, 20);
        const a = creeper(20, 16, { id: 1 });
        const b = creeper(24.5, 20, { id: 2 });
        const d = C.decide(state({ botPos: bot, areas: [], creepers: [a, b] }));
        assert.equal(d.step, 'back_off');
        assert.equal(d.creeper, 1);
        assert.ok(dist(d.moveTo, a.pos) > dist(bot, a.pos));
        assert.ok(dist(d.moveTo, b.pos) > dist(bot, b.pos), 'also away from the second one');
    });

    test('creepers on both sides: the distance to the named one still grows', () => {
        const bot = p(20, 20);
        const a = creeper(20, 16.5, { id: 1 });
        const b = creeper(20, 24, { id: 2 });
        const d = C.decide(state({ botPos: bot, areas: [], creepers: [a, b] }));
        assert.equal(d.step, 'back_off');
        const named = [a, b].find(c => c.id === d.creeper);
        assert.ok(dist(d.moveTo, named.pos) > dist(bot, named.pos));
    });

    test('a creeper exactly at the bot: some direction, away from the area', () => {
        const bot = p(4.5, 12);
        const d = C.decide(state({ botPos: bot, creepers: [creeper(4.5, 12)] }));
        assert.equal(d.step, 'back_off');
        assert.ok(minAreaDist([HOUSE], d.moveTo) > minAreaDist([HOUSE], bot));
    });

    test('back_off avoids running into an area when it can', () => {
        // Creeper north of the bot, the house south of it: straight away would enter the house.
        const bot = p(4.5, -4);
        const d = C.decide(state({ botPos: bot, creepers: [creeper(4.5, -8)] }));
        assert.equal(d.step, 'back_off');
        assert.equal(insideAny([HOUSE], d.moveTo), false, JSON.stringify(d.moveTo));
        assert.ok(dist(d.moveTo, p(4.5, -8)) > dist(bot, p(4.5, -8)));
    });
});

describe('decide: lure', () => {
    test('the bot at the door, a creeper 10 blocks from the house: lure away from both', () => {
        const bot = p(4.5, 9.5);
        const c = creeper(12.5, 13.5);
        const d = C.decide(state({ botPos: bot, creepers: [c] }));
        assert.equal(d.step, 'lure');
        assert.equal(d.area, 'home');
        assert.equal(d.sprint, false);
        assert.equal(insideAny([HOUSE], d.moveTo), false);
        assert.ok(dist(d.moveTo, c.pos) >= dist(bot, c.pos));
        assert.ok(minAreaDist([HOUSE], d.moveTo) >= minAreaDist([HOUSE], bot));
    });

    test('the creeper between the bot and the house: the bot leads it farther out', () => {
        const bot = p(21, 4.5);
        const c = creeper(14, 4.5);
        const d = C.decide(state({ botPos: bot, creepers: [c] }));
        assert.equal(d.step, 'lure');
        assert.ok(d.moveTo.x > bot.x, JSON.stringify(d.moveTo));
        assert.ok(dist(d.moveTo, c.pos) > dist(bot, c.pos));
    });

    test('the bot between the creeper and the house: it goes sideways, not closer to either', () => {
        const bot = p(12, 4.5);
        const c = creeper(19, 4.5);
        const d = C.decide(state({ botPos: bot, creepers: [c] }));
        assert.equal(d.step, 'lure');
        assert.equal(insideAny([HOUSE], d.moveTo), false);
        assert.ok(dist(d.moveTo, c.pos) >= dist(bot, c.pos));
        assert.ok(Math.abs(d.moveTo.z - bot.z) > 2, 'sideways');
    });

    test('beyond 10 blocks it waits for a creeper that follows: moveTo is its own position', () => {
        // Amendment 2 F3: it waits only while the creeper came at least 1 block closer in the last 3 s
        const bot = p(4.5, 20);
        const d = C.decide(state({ botPos: bot, creepers: [creeper(4.5, 9.5)], following: [7] }));
        assert.equal(d.step, 'lure');
        assert.equal(d.reason, 'wait');
        assert.deepEqual(d.moveTo, bot);
        assert.equal(d.sprint, false);
    });

    test('a creeper that stops following near the house: the bot walks back towards it to be seen (F3)', () => {
        const bot = p(4.5, 30);
        const c = creeper(4.5, 18);
        const d = C.decide(state({ botPos: bot, creepers: [c] }));
        assert.equal(d.step, 'lure');
        assert.equal(d.reason, 'attention');
        assert.equal(d.sprint, false);
        const dc = dist(d.moveTo, c.pos);
        assert.ok(dc >= 8 - 1e-9 && dc <= 10 + 1e-9, `10 blocks away, never closer than 8: ${dc}`);
        assert.ok(dist(d.moveTo, c.pos) < dist(bot, c.pos), 'towards the creeper');
        assert.equal(insideAny([HOUSE], d.moveTo), false);
    });

    test('a creeper that stops following away from the house: none', () => {
        const d = C.decide(state({ botPos: p(4.5, 30), creepers: [creeper(4.5, 47)] }));
        assert.equal(d.step, 'none');
    });

    test('the lure is done when the creeper is 16 blocks from every area: run', () => {
        const bot = p(4.5, 32);
        const c = creeper(4.5, 25.5);
        const d = C.decide(state({ botPos: bot, creepers: [c] }));
        assert.equal(G.distanceToBox(HOUSE, c.pos) > 16, true);
        assert.equal(d.step, 'run');
    });

    test('two areas: the lure point is in neither and does not cross them', () => {
        const barn = box('barn', 20, 0, 28, 8);
        const areas = [HOUSE, barn];
        const bot = p(14.5, 4.5);
        const c = creeper(14.5, 12);
        const d = C.decide(state({ areas, botPos: bot, creepers: [c] }));
        assert.equal(d.step, 'lure');
        assert.equal(insideAny(areas, d.moveTo), false);
        assert.equal(areas.some(a => G.segmentCrossesBox(bot, d.moveTo, a)), false);
        assert.ok(dist(d.moveTo, c.pos) >= dist(bot, c.pos));
    });

    test('the bot in a corner between two areas: never into an area, never closer to the creeper', () => {
        const west = box('west', 0, 0, 8, 20);
        const south = box('south', 9, 0, 25, 8);
        const areas = [west, south];
        const bot = p(10.5, 10.5);
        const c = creeper(16.5, 16.5);
        const d = C.decide(state({ areas, botPos: bot, creepers: [c] }));
        assert.equal(d.step, 'lure');
        assert.equal(insideAny(areas, d.moveTo), false);
        assert.ok(dist(d.moveTo, c.pos) >= dist(bot, c.pos) - 1e-9);
        const close = C.decide(state({ areas, botPos: bot, creepers: [creeper(13.5, 13.5)] }));
        assert.equal(close.step, 'back_off');
        assert.ok(dist(close.moveTo, p(13.5, 13.5)) > dist(bot, p(13.5, 13.5)));
    });

    test('several creepers near the area: the one nearest to the area is the target', () => {
        const d = C.decide(state({ botPos: p(4.5, 16), creepers: [creeper(12, 22, { id: 1 }), creeper(10.5, 10.5, { id: 2 })] }));
        assert.equal(d.step, 'lure');
        assert.equal(d.creeper, 2);
    });
});

describe('decide: fight, run, help', () => {
    const far = { botPos: p(60, 60), creepers: [creeper(60, 68)] };

    test('run: 32 blocks away from the creeper, sprinting', () => {
        const d = C.decide(state(far));
        assert.equal(d.step, 'run');
        assert.equal(d.sprint, true);
        assert.ok(dist(d.moveTo, p(60, 68)) >= 32 + 8 - 1e-6);
    });

    test('run does not lead towards an area', () => {
        // The house is straight behind the bot as seen from the creeper.
        const bot = p(4.5, 34);
        const c = creeper(4.5, 42);
        const d = C.decide(state({ botPos: bot, creepers: [c] }));
        assert.equal(d.step, 'run');
        assert.ok(minAreaDist([HOUSE], d.moveTo) >= minAreaDist([HOUSE], bot) - 1e-6, JSON.stringify(d.moveTo));
        assert.ok(dist(d.moveTo, c.pos) > dist(bot, c.pos));
    });

    test('fight only with fighting and canFight', () => {
        const d = C.decide(state({ ...far, fighting: true, canFight: true }));
        assert.equal(d.step, 'fight');
        assert.equal(d.creeper, 7);
        assert.equal(C.decide(state({ ...far, fighting: true, canFight: false })).step, 'run');
        assert.equal(C.decide(state({ ...far, fighting: false, canFight: true })).step, 'run');
    });

    test('no fight while the creeper is still near an area: lure first', () => {
        const d = C.decide(state({ botPos: p(4.5, 16), creepers: [creeper(4.5, 10)], fighting: true, canFight: true }));
        assert.equal(d.step, 'lure');
    });

    test('help after 3 tries, with the text, moving away from the creeper and the buildings', () => {
        const bot = p(4.5, 16);
        const c = creeper(4.5, 23);
        const d = C.decide(state({ botPos: bot, creepers: [c], tries: 3 }));
        assert.equal(d.step, 'help');
        assert.equal(d.text, HELP);
        assert.equal(d.sprint, true);
        assert.ok(dist(d.moveTo, c.pos) > dist(bot, c.pos));
        assert.equal(insideAny([HOUSE], d.moveTo), false);
        assert.equal(C.decide(state({ botPos: bot, creepers: [c], tries: 2 })).step, 'lure');
    });

    test('help needs a creeper: with none it is none', () => {
        assert.equal(C.decide(state({ tries: 9 })).step, 'none');
    });

    test('CREEPER_RULES holds the numbers of the spec', () => {
        assert.equal(C.CREEPER_RULES.fuseDistance, 3);
        assert.equal(C.CREEPER_RULES.giveUpDistance, 7);
        assert.equal(C.CREEPER_RULES.backOffDistance, 5);
        assert.equal(C.CREEPER_RULES.backOffRun, 12);
        assert.equal(C.CREEPER_RULES.noticeDistance, 16);
        assert.equal(C.CREEPER_RULES.lureMax, 10);
        assert.equal(C.CREEPER_RULES.runDistance, 32);
        assert.equal(C.CREEPER_RULES.helpTries, 3);
    });

    test('fuseIsBurning', () => {
        assert.equal(C.fuseIsBurning({ fuse: true }), true);
        assert.equal(C.fuseIsBurning({ fuse: 1 }), true);
        assert.equal(C.fuseIsBurning({ fuse: -1 }), false);
        assert.equal(C.fuseIsBurning({}), false);
        assert.equal(C.fuseIsBurning(null), false);
    });
});

// Deterministic random numbers for the property tests.
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function randomScene(rand) {
    const areas = [];
    const count = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) {
        const x = Math.floor(rand() * 60 - 30);
        const z = Math.floor(rand() * 60 - 30);
        areas.push(box(`a${i}`, x, z, x + 4 + Math.floor(rand() * 12), z + 4 + Math.floor(rand() * 12)));
    }
    let bot;
    for (let tries = 0; tries < 100; tries++) {
        const cand = p(rand() * 100 - 50, rand() * 100 - 50);
        if (!areas.some(a => G.containsPos(G.expandBox(a, 1), cand))) {
            bot = cand;
            break;
        }
    }
    const angle = rand() * Math.PI * 2;
    const r = 0.5 + rand() * 20;
    const c = creeper(bot.x + Math.cos(angle) * r, bot.z + Math.sin(angle) * r, { fuse: rand() < 0.1 });
    return { areas, bot, c, tries: rand() < 0.1 ? 3 : 0 };
}

describe('decide: properties for random positions', () => {
    test('lure never ends inside an area and never closer to the creeper (a creeper that follows)', () => {
        const rand = mulberry32(12345);
        let lures = 0;
        for (let i = 0; i < 3000; i++) {
            const { areas, bot, c } = randomScene(rand);
            if (!bot) continue;
            const d = C.decide(state({ areas, botPos: bot, creepers: [{ ...c, fuse: false }], following: [c.id] }));
            if (d.step !== 'lure') continue;
            lures++;
            assert.equal(insideAny(areas, d.moveTo), false, `case ${i}: ${JSON.stringify({ areas, bot, c, d })}`);
            assert.ok(dist(d.moveTo, c.pos) >= dist(bot, c.pos) - 1e-9, `case ${i}: closer to the creeper`);
            assert.equal(d.moveTo.y, bot.y);
        }
        assert.ok(lures > 200, `enough lure cases: ${lures}`);
    });

    test('back_off always increases the distance to the creeper', () => {
        const rand = mulberry32(777);
        let count = 0;
        for (let i = 0; i < 3000; i++) {
            const { areas, bot, c } = randomScene(rand);
            if (!bot) continue;
            const d = C.decide(state({ areas, botPos: bot, creepers: [c] }));
            if (d.step !== 'back_off') continue;
            count++;
            assert.ok(dist(d.moveTo, c.pos) > dist(bot, c.pos), `case ${i}: ${JSON.stringify({ bot, c, d })}`);
            assert.equal(d.sprint, true);
        }
        assert.ok(count > 200, `enough back_off cases: ${count}`);
    });

    test('run and help never lead closer to the creeper and never into an area when the bot is outside', () => {
        const rand = mulberry32(4242);
        let count = 0;
        for (let i = 0; i < 3000; i++) {
            const { areas, bot, c, tries } = randomScene(rand);
            if (!bot) continue;
            const d = C.decide(state({ areas, botPos: bot, creepers: [{ ...c, fuse: false }], tries }));
            if (d.step !== 'run' && d.step !== 'help') continue;
            count++;
            assert.ok(dist(d.moveTo, c.pos) > dist(bot, c.pos), `case ${i}`);
            assert.equal(insideAny(areas, d.moveTo), false, `case ${i}: ${JSON.stringify({ areas, bot, c, d })}`);
        }
        assert.ok(count > 100, `enough run cases: ${count}`);
    });

    test('the attention walk (F3) never ends inside an area, never closer than 8 and never farther than 10 from the creeper', () => {
        const rand = mulberry32(2468);
        let count = 0;
        for (let i = 0; i < 3000; i++) {
            const { areas, bot, c } = randomScene(rand);
            if (!bot) continue;
            const d = C.decide(state({ areas, botPos: bot, creepers: [{ ...c, fuse: false }], attention: Math.floor(rand() * 2) }));
            if (d.reason !== 'attention') continue;
            count++;
            const dc = dist(d.moveTo, c.pos);
            assert.ok(dc >= 8 - 1e-9 && dc <= 10 + 1e-9, `case ${i}: ${dc}`);
            assert.equal(insideAny(areas.map(a => G.expandBox(a, 1)), d.moveTo), false, `case ${i}: ${JSON.stringify({ areas, bot, c, d })}`);
            assert.equal(d.sprint, false);
            assert.equal(d.moveTo.y, bot.y);
        }
        assert.ok(count > 100, `enough attention cases: ${count}`);
    });

    test('decide never throws and always returns a known step', () => {
        const rand = mulberry32(99);
        const steps = new Set(['none', 'back_off', 'lure', 'fight', 'run', 'help', 'leave_it']);
        for (let i = 0; i < 2000; i++) {
            const { areas, bot, c, tries } = randomScene(rand);
            const d = C.decide(state({ areas, botPos: bot, creepers: [c, { ...c, id: 8, pos: p(c.pos.x + 3, c.pos.z - 2) }], tries, fighting: rand() < 0.5, canFight: rand() < 0.5,
                attention: Math.floor(rand() * 3), following: rand() < 0.5 ? [7] : [], standing: rand() < 0.3 ? [8] : 'x' }));
            assert.ok(steps.has(d.step), d.step);
        }
    });
});

// ---------------------------------------------------------------- Amendment 2, F3
// A creeper that does not follow: the bot waits only while the creeper comes closer; otherwise it walks
// back towards it (10 blocks, never closer than 8) to be seen. After 2 such attention tries the
// creeper counts as standing: leave_it. A standing creeper does not start the procedure again for 60
// seconds, unless it comes within 10 blocks of the bot.
const STANDING = 'A creeper stands near "home" and does not follow me. I keep away from it.';

describe('F3: decide with a creeper that does not follow', () => {
    const far = { botPos: p(4.5, 30), creepers: [creeper(4.5, 18)] };

    test('first and second attention try: the bot walks towards the creeper', () => {
        for (const attention of [0, 1]) {
            const d = C.decide(state({ ...far, attention }));
            assert.equal(d.step, 'lure', `attention ${attention}`);
            assert.equal(d.reason, 'attention');
            assert.equal(d.creeper, 7);
            assert.equal(d.area, 'home');
        }
    });

    test('after 2 attention tries: leave_it with the text of F3, no move', () => {
        const d = C.decide(state({ ...far, attention: 2 }));
        assert.equal(d.step, 'leave_it');
        assert.equal(d.text, STANDING);
        assert.equal(d.creeper, 7);
        assert.equal(d.area, 'home');
        assert.equal(d.moveTo, null);
        assert.equal(d.sprint, false);
        assert.equal(C.decide(state({ ...far, attention: 5 })).step, 'leave_it');
    });

    test('the second walk towards the creeper is finished before the creeper counts as standing', () => {
        // found on the real server: the second try counted as done when it began
        const d = C.decide(state({ ...far, attention: 2, attending: true }));
        assert.equal(d.step, 'lure');
        assert.equal(d.reason, 'attention');
        assert.equal(C.decide(state({ ...far, attention: 2, attending: false })).step, 'leave_it');
    });

    test('a creeper that comes closer: the bot waits, whatever the attention tries', () => {
        const d = C.decide(state({ ...far, attention: 2, following: [7] }));
        assert.equal(d.step, 'lure');
        assert.equal(d.reason, 'wait');
        assert.deepEqual(d.moveTo, far.botPos);
    });

    test('attention tries do not change what happens within 10 blocks: the lure leads', () => {
        const d = C.decide(state({ botPos: p(4.5, 16), creepers: [creeper(4.5, 10)], attention: 2 }));
        assert.equal(d.step, 'lure');
        assert.equal(d.reason, 'lead');
    });

    test('back_off still wins over leave_it', () => {
        const d = C.decide(state({ botPos: p(4.5, 16), creepers: [creeper(4.5, 12)], attention: 2 }));
        assert.equal(d.step, 'back_off');
    });

    test('a standing creeper beyond 10 blocks of the bot does not count: none', () => {
        const d = C.decide(state({ ...far, standing: [7] }));
        assert.equal(d.step, 'none');
        const alsoAtTheHouse = C.decide(state({ botPos: p(4.5, 11), creepers: [creeper(-3, -3)], standing: [7] }));
        assert.equal(alsoAtTheHouse.step, 'none');
    });

    test('a standing creeper that comes within 10 blocks of the bot counts again', () => {
        const d = C.decide(state({ botPos: p(4.5, 27), creepers: [creeper(4.5, 18)], standing: [7] }));
        assert.equal(d.step, 'lure');
        assert.equal(d.reason, 'lead');
        assert.equal(C.decide(state({ botPos: p(4.5, 22), creepers: [creeper(4.5, 18)], standing: [7] })).step, 'back_off');
    });

    test('a standing creeper does not hide another creeper', () => {
        const d = C.decide(state({ botPos: p(4.5, 30), creepers: [creeper(4.5, 18, { id: 1 }), creeper(10.5, 12, { id: 2 })], standing: [1] }));
        assert.equal(d.step, 'lure');
        assert.equal(d.creeper, 2);
    });

    test('the house between the bot and the creeper: the attention point is beside it, not inside', () => {
        const bot = p(4.5, 30);
        const c = creeper(4.5, -4);
        const d = C.decide(state({ botPos: bot, creepers: [c] }));
        assert.equal(d.reason, 'attention');
        const dc = dist(d.moveTo, c.pos);
        assert.ok(dc >= 8 - 1e-9 && dc <= 10 + 1e-9, String(dc));
        assert.equal(insideAny([G.expandBox(HOUSE, 1)], d.moveTo), false, JSON.stringify(d.moveTo));
    });

    test('no free place 8 to 10 blocks from the creeper: leave_it at once', () => {
        const field = box('field', -20, -20, 20, 20, 'farm');
        const d = C.decide(state({ areas: [field], botPos: p(30, 30), creepers: [creeper(0.5, 0.5)] }));
        assert.equal(d.step, 'leave_it');
        assert.equal(d.text, 'A creeper stands near "field" and does not follow me. I keep away from it.');
    });

    test('CREEPER_RULES holds the numbers of F3', () => {
        assert.equal(C.CREEPER_RULES.followWindowMs, 3000);
        assert.equal(C.CREEPER_RULES.followMin, 1);
        assert.equal(C.CREEPER_RULES.attentionMin, 8);
        assert.equal(C.CREEPER_RULES.attentionTries, 2);
        assert.equal(C.CREEPER_RULES.standingMs, 60000);
        assert.equal(C.CREEPER_RULES.standingNear, 10);
    });
});

describe('F3: CreeperWatch', () => {
    const at = (x, z) => ({ id: 7, pos: p(x, z) });

    test('a creeper that came at least 1 block closer to the bot within 3 s follows', () => {
        const w = new C.CreeperWatch();
        const bot = p(4.5, 30);
        w.observe([at(4.5, 18)], bot, 1000);
        assert.deepEqual(w.observe([at(4.5, 18.6)], bot, 2000).following, []);
        assert.deepEqual(w.observe([at(4.5, 19.1)], bot, 3000).following, [7], '1.1 blocks in 2 s');
    });

    test('less than 1 block in 3 s is not following; older samples do not count', () => {
        const w = new C.CreeperWatch();
        const bot = p(4.5, 30);
        w.observe([at(4.5, 17)], bot, 1000);
        w.observe([at(4.5, 18)], bot, 1500);
        assert.deepEqual(w.observe([at(4.5, 18.9)], bot, 4600).following, [], 'the move from 17 to 18 is older than 3 s');
    });

    test('the bot walking towards a creeper that stands is not following', () => {
        const w = new C.CreeperWatch();
        w.observe([at(4.5, 18)], p(4.5, 30), 1000);
        w.observe([at(4.5, 18)], p(4.5, 27), 2000);
        assert.deepEqual(w.observe([at(4.5, 18)], p(4.5, 25), 3000).following, []);
    });

    test('attention tries: one per walk towards the creeper, a new one after 10 s', () => {
        const w = new C.CreeperWatch();
        const attention = { step: 'lure', reason: 'attention', creeper: 7 };
        const lead = { step: 'lure', reason: 'lead', creeper: 7 };
        w.note(attention, 1000);
        w.note(attention, 1400);
        assert.equal(w.facts(p(0, 0), 1400).attention, 1);
        assert.equal(w.facts(p(0, 0), 1400).attending, true, 'the walk goes on');
        w.note(lead, 2000);
        assert.equal(w.facts(p(0, 0), 2000).attending, false, 'the walk is over');
        w.note(attention, 3000);
        assert.equal(w.facts(p(0, 0), 3000).attention, 2);
        assert.equal(w.facts(p(0, 0), 12999).attending, true);
        assert.equal(w.facts(p(0, 0), 13000).attending, false, 'a walk of 10 s is over');
        w.note(attention, 13500);
        assert.equal(w.facts(p(0, 0), 13500).attention, 3, 'a walk that takes more than 10 s counts again');
        w.startRun();
        assert.equal(w.facts(p(0, 0), 13500).attention, 0);
        assert.equal(w.facts(p(0, 0), 13500).attending, false);
    });

    test('the creeper follows: the attention tries start again', () => {
        const w = new C.CreeperWatch();
        const bot = p(4.5, 30);
        w.note({ step: 'lure', reason: 'attention', creeper: 7 }, 1000);
        w.observe([at(4.5, 18)], bot, 1000);
        assert.equal(w.observe([at(4.5, 20)], bot, 2500).attention, 0);
    });

    test('leave_it: the creeper stands for 60 s, unless it comes within 10 blocks of the bot', () => {
        const w = new C.CreeperWatch();
        const bot = p(4.5, 30);
        w.note({ step: 'leave_it', creeper: 7 }, 1000);
        assert.deepEqual(w.observe([at(4.5, 18)], bot, 30000).standing, [7]);
        assert.deepEqual(w.observe([at(4.5, 18)], bot, 61001).standing, [], 'after 60 s');
        w.note({ step: 'leave_it', creeper: 7 }, 70000);
        assert.deepEqual(w.observe([at(4.5, 18)], bot, 71000).standing, [7]);
        assert.deepEqual(w.observe([at(4.5, 21)], bot, 72000).standing, [], 'within 10 blocks of the bot');
        assert.deepEqual(w.observe([at(4.5, 18)], bot, 80000).standing, [], 'it does not stand again by itself');
    });

    test('bad input never throws', () => {
        const w = new C.CreeperWatch();
        assert.doesNotThrow(() => w.observe(null, null, NaN));
        assert.doesNotThrow(() => w.observe([null, { id: 1 }, { id: 2, pos: { x: 'a' } }], p(0, 0), 1));
        assert.doesNotThrow(() => w.note(null, 1));
        assert.deepEqual(w.facts(p(0, 0), 1), { following: [], attention: 0, attending: false, standing: [] });
    });
});

// The procedure as a pure simulation: decide every 400 ms with a CreeperWatch, the bot walks
// 4.3 blocks per second (5.6 sprinting) towards moveTo, the creeper stands or follows the bot.
// turnDelay: the bot does not move in the first tick after its goal changed (the path finder computes
// a path and turns around), as on the real server.
function simulate({ bot, creeperAt, follows, areas = [HOUSE], ticks = 225, walk = 4.3, turnDelay = false }) {
    const w = new C.CreeperWatch();
    w.startRun();
    let b = { ...bot };
    let c = { ...creeperAt };
    const log = [];
    let lastReason = null;
    for (let i = 0, t = 1000; i < ticks; i++, t += 400) {
        const facts = w.observe([{ id: 7, pos: c }], b, t);
        const d = C.decide(state({ areas, botPos: b, creepers: [{ id: 7, pos: c, fuse: false }], ...facts, now: t }));
        w.note(d, t);
        log.push({ t, step: d.step, reason: d.reason, bot: b, creeper: c, attention: facts.attention });
        if (d.step === 'none' || d.step === 'leave_it' || d.step === 'run') break;
        const turning = turnDelay && d.reason !== lastReason;
        lastReason = d.reason;
        if (d.moveTo && d.reason !== 'wait' && !turning) {
            const speed = (d.sprint ? 5.6 : walk) * 0.4;
            const dd = Math.hypot(d.moveTo.x - b.x, d.moveTo.z - b.z);
            const s = Math.min(dd, speed);
            if (dd > 1e-9) b = { x: b.x + (d.moveTo.x - b.x) / dd * s, y: b.y, z: b.z + (d.moveTo.z - b.z) / dd * s };
        }
        const dc = Math.hypot(b.x - c.x, b.z - c.z);
        if (follows && dc <= 16 && dc > 2) {
            const s = Math.min(dc - 2, 3.6 * 0.4);
            c = { x: c.x + (b.x - c.x) / dc * s, y: c.y, z: c.z + (b.z - c.z) / dc * s };
        }
    }
    return { log, last: log[log.length - 1], watch: w };
}

describe('F3: the procedure in a pure simulation', () => {
    test('the owner scenario with a creeper that stands: 2 attention tries, then leave_it', () => {
        const { log, last, watch } = simulate({ bot: p(4.5, 9.5), creeperAt: p(4.5, 19), follows: false });
        assert.equal(last.step, 'leave_it', JSON.stringify(log.slice(-3)));
        assert.equal(last.attention, 2);
        const walks = log.filter((x, i) => x.reason === 'attention' && (i === 0 || log[i - 1].reason !== 'attention')).length;
        assert.equal(walks, 2, 'two walks towards the creeper');
        assert.ok(log.length * 0.4 < 90, `within 90 s: ${log.length * 0.4} s`);
        assert.equal(log.some(x => G.containsPos(G.interiorBox(HOUSE), x.bot)), false, 'never into the house');
        assert.ok(log.every(x => dist(x.bot, x.creeper) > 5), 'never within 5 blocks of the creeper');
        assert.deepEqual(watch.facts(last.bot, last.t).standing, [7]);
    });

    test('a slow bot: both walks towards the creeper end 10 blocks from it before it counts as standing', () => {
        // on the real server the bot walks less far per decision than in the other simulations
        const { log, last } = simulate({ bot: p(4.5, 9.5), creeperAt: p(4.5, 19), follows: false, walk: 1.5, turnDelay: true });
        assert.equal(last.step, 'leave_it', JSON.stringify(log.slice(-3)));
        let completed = 0;
        for (let i = 1; i < log.length; i++) {
            if (log[i - 1].reason === 'attention' && log[i].reason !== 'attention') {
                completed++;
                assert.ok(dist(log[i].bot, log[i].creeper) <= 10 + 1e-9, `walk ${completed} ended 10 blocks from the creeper`);
            }
        }
        assert.equal(completed, 2, JSON.stringify(log.map(x => `${x.reason}:${dist(x.bot, x.creeper).toFixed(1)}`)));
    });

    test('a creeper that follows: never leave_it, the lure ends when it is 16 blocks from the house', () => {
        const { log, last } = simulate({ bot: p(4.5, 9.5), creeperAt: p(4.5, 19), follows: true });
        assert.equal(log.some(x => x.step === 'leave_it'), false);
        assert.equal(last.step, 'run', JSON.stringify(last));
        assert.ok(G.distanceToBox(HOUSE, last.creeper) > 16);
    });

    test('a creeper far from the bot that stands at the house: attention, then leave_it', () => {
        const { last } = simulate({ bot: p(4.5, 34), creeperAt: p(4.5, 20), follows: false });
        assert.equal(last.step, 'leave_it');
    });
});
