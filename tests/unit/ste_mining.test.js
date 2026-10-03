// Spec v0.1.4.8 E4 (part E, engineer E5): the minimum of mining. Ladders only for the part of the
// way down that has none, a trip without a known mine asks and does nothing, a new entrance keeps
// 16 blocks from the house and the areas of people and never starts underground, the bot says what
// it prepares, and eatIfHungry sees the off-hand.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeMiningBot, makeClock, makeCtx, give, count } from './mining_fake_bot.test.js';

const L = await loadSrc('src/agent/packs/mining/mine_logic.js');
const T = await loadSrc('src/agent/packs/mining/texts.js');
const M = await loadSrc('src/agent/packs/mining/mining.js');
const P = await loadSrc('src/agent/packs/mining/index.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

// The mine of the owner (mines.json of the play test): a shaft of ladders from 66 down to 25, level 16, no base.
const OWNER_MINE = {
    ore: 'iron', entrance: { x: 9, y: 67, z: 58 }, level: 16, base: null, chest: null, direction: 'west', length: 0, shaft: 'ladder',
    dimension: 'overworld', ores: ['iron'], end: null, tunnel: [],
    route: [{ kind: 'ladder', x: 9, z: 58, top: 66, bottom: 25, face: 'west', entry: { x: 10, y: 67, z: 58 } }],
};

function kit(bot, { ladders = 64, torches = 16, cobble = 64, pickaxe = 'iron_pickaxe', chests = 2, food = 8 } = {}) {
    if (pickaxe) give(bot, pickaxe, 1);
    if (ladders) give(bot, 'ladder', ladders);
    if (cobble) give(bot, 'cobblestone', cobble);
    if (torches) give(bot, 'torch', torches);
    if (food) give(bot, 'bread', food);
    if (chests) give(bot, 'chest', chests);
}

async function scene({ pos = [0.5, 64, 0.5], world = makeWorld(), gear = {} } = {}) {
    const bot = makeMiningBot({ world, pos });
    const clock = makeClock(bot);
    const ctx = await makeCtx(clock);
    kit(bot, gear);
    return { world, bot, clock, ctx, opts: { now: clock.now, wait: clock.wait } };
}

const digs = bot => bot.calls.filter(c => c[0] === 'dig').length;
const places = bot => bot.calls.filter(c => c[0] === 'place').length;

describe('tripNeeds: ladders only for the part of the way that has none (M1, M2)', () => {
    test('the mine of the owner: 42 ladders down to 25, level 16: 10 ladders, and a chest for the base', () => {
        const r = L.tripNeeds('iron', 67, 16, [], { shaftExists: true, wayDownTo: 25, hasBase: false, tunnelLength: 32 });
        assert.deepEqual(r.needs.find(n => n.name === 'ladder'), { name: 'ladder', count: 10 });
        assert.equal(r.rest, 9);
        assert.equal(r.depth, 51);
        assert.deepEqual(r.needs.find(n => n.name === 'chest'), { name: 'chest', count: 1 });
        assert.equal(r.blocks, 9 + 24 + 64);
    });

    test('a way that reaches the level needs no ladders; a mine with a base no chest', () => {
        const r = L.tripNeeds('iron', 67, 16, [], { shaftExists: true, wayDownTo: 16, hasBase: true, tunnelLength: 10 });
        assert.equal(r.needs.find(n => n.name === 'ladder'), undefined);
        assert.equal(r.needs.find(n => n.name === 'chest'), undefined);
        assert.equal(r.rest, 0);
        assert.equal(r.blocks, 20);
    });

    test('without wayDownTo an existing shaft reaches the level (v0.1.4.7); a new shaft keeps its minimum of 8', () => {
        const old = L.tripNeeds('iron', 61, 16, [], { shaftExists: true, tunnelLength: 10 });
        assert.equal(old.needs.find(n => n.name === 'ladder'), undefined);
        assert.equal(old.needs.find(n => n.name === 'chest'), undefined);
        assert.equal(L.tripNeeds('coal', 61, 58, []).needs.find(n => n.name === 'ladder').count, 8);
        assert.equal(L.tripNeeds('iron', 67, 16, [], { shaftExists: true, wayDownTo: 18, hasBase: true }).needs.find(n => n.name === 'ladder').count, 3,
            'the rest of 2 blocks plus 10 percent, no minimum');
    });

    test('ladders carried count against the rest', () => {
        const r = L.tripNeeds('iron', 67, 16, [{ name: 'ladder', count: 4 }], { shaftExists: true, wayDownTo: 25, hasBase: true });
        assert.deepEqual(r.missing.find(m => m.name === 'ladder'), { name: 'ladder', count: 6 });
    });
});

describe('tripStart (E4)', () => {
    test('every row', () => {
        assert.equal(L.tripStart({ mine: OWNER_MINE }), 'use');
        assert.equal(L.tripStart({ mine: OWNER_MINE, underground: true, newMine: true }), 'use', 'a known mine is used from anywhere');
        assert.equal(L.tripStart({ mine: null, underground: true, newMine: true }), 'underground');
        assert.equal(L.tripStart({ mine: null, underground: true }), 'underground');
        assert.equal(L.tripStart({ mine: null }), 'ask');
        assert.equal(L.tripStart({ mine: null, newMine: false }), 'ask');
        assert.equal(L.tripStart({ mine: null, newMine: true }), 'new');
        assert.equal(L.tripStart(undefined), 'ask');
    });
});

describe('entranceAllowed: 16 blocks from home, building, pen, farm and the place home (M5)', () => {
    const box = (type, extra = {}) => ({ name: type, type, min: { x: 0, y: 60, z: 0 }, max: { x: 6, y: 65, z: 6 }, ...extra });

    test('each kept type: 15.5 blocks is too near, 16.5 is allowed', () => {
        for (const type of ['home', 'building', 'pen', 'farm']) {
            assert.equal(L.entranceAllowed({ x: 22, z: 3 }, [box(type)]), false, `${type}: centre 22.5 is 15.5 from the side at 7`);
            assert.equal(L.entranceAllowed({ x: 23, z: 3 }, [box(type)]), true, `${type}: 16.5`);
        }
        assert.deepEqual([...L.ENTRANCE_AREA_TYPES], ['home', 'building', 'pen', 'farm']);
        assert.equal(L.ENTRANCE_DISTANCE, 16);
    });

    test('an area without a type counts as a building; a mine keeps only the 8 blocks of shaftAllowed', () => {
        const untyped = { min: { x: 0, y: 60, z: 0 }, max: { x: 6, y: 65, z: 6 } };
        assert.equal(L.entranceAllowed({ x: 22, z: 3 }, [untyped]), false);
        assert.equal(L.entranceAllowed({ x: 15, z: 3 }, [box('mine')]), true, '8.5 from a mine');
        assert.equal(L.entranceAllowed({ x: 14, z: 3 }, [box('mine')]), false, '7.5 from a mine');
    });

    test('the place home: 16 blocks from the point', () => {
        const homes = [{ x: 12.46, z: 52.51 }];
        assert.equal(L.entranceAllowed({ x: 9, z: 58 }, [], homes), false, 'the shaft of the play test, about 6.5 blocks from home');
        assert.equal(L.entranceAllowed({ x: 12, z: 36 }, [], homes), true, '16.01 blocks');
        assert.equal(L.entranceAllowed({ x: 12, z: 37 }, [], homes), false, '15.01 blocks');
        assert.equal(L.entranceAllowed({ x: 12, z: 37 }, [], [null, { x: 'a' }]), true, 'bad points are left out');
    });

    test('chooseEntrance keeps 16 blocks from the place home', () => {
        const ground = () => ({ y: 66, name: 'grass_block' });
        const home = { x: 12.46, z: 52.51 };
        const e = L.chooseEntrance({ bot: { x: 10.5, y: 67, z: 50.5 }, level: 16, areas: [], ground, homes: [home] });
        assert.ok(e);
        assert.ok(Math.hypot(e.x + 0.5 - home.x, e.z + 0.5 - home.z) >= 16, JSON.stringify(e));
        const back = L.offset(e, L.backOf(e.dir));
        assert.ok(Math.hypot(back.x + 0.5 - home.x, back.z + 0.5 - home.z) >= 16, 'the place behind the shaft too');
    });
});

describe('texts (E4)', () => {
    test('the question word for word, with and without a house, and without a place', () => {
        assert.equal(T.askMineText('iron', { x: 30, y: 67, z: 58 }, 21.4),
            'I know no mine for iron. I can dig a new one at (30, 67, 58), 21 blocks from your house. Tell me to do it, or show me your mine.');
        assert.equal(T.askMineText('coal', { x: 1, y: 64, z: -2 }, null),
            'I know no mine for coal. I can dig a new one at (1, 64, -2). Tell me to do it, or show me your mine.');
        assert.equal(T.askMineText('iron', null),
            'I know no mine for iron. I found no place for a mine within 48 blocks that is at least 16 blocks from your house and the areas I protect. Show me your mine.');
    });

    test('underground, word for word', () => {
        assert.equal(T.TEXTS.underground, 'I am underground. I start a new mine only from the surface.');
    });

    test('supplies: the example of the spec, and every kind', () => {
        assert.equal(T.suppliesText([{ name: 'ladder', count: 16 }, { name: 'torch', count: 8 }, { name: 'chest', count: 1 }]),
            'I get my supplies: 16 ladders, 8 torches, a chest.');
        assert.equal(T.suppliesText([{ name: 'chest', count: 1 }, { name: 'food', count: 8 }, { name: 'cobblestone', count: 32 },
            { name: 'pickaxe', material: 'stone', count: 1 }, { name: 'ladder', count: 1 }, { name: 'torch', count: 1 }]),
        'I get my supplies: a stone pickaxe, 1 ladder, 1 torch, 8 food, a chest.', 'cobblestone comes with the way down');
        assert.equal(T.suppliesText([{ name: 'pickaxe', material: 'iron', count: 1, spare: true }]), 'I get my supplies: a second iron pickaxe.');
        assert.equal(T.suppliesText([{ name: 'cobblestone', count: 32 }]), '');
        assert.equal(T.suppliesText(null), '');
        assert.equal(T.suppliesStoppedText([{ name: 'ladder', count: 16 }, { name: 'chest', count: 1 }]),
            'I was stopped while I got my supplies. I still lack 16 ladders, a chest.');
        assert.equal(T.suppliesStoppedText([]), 'I was stopped while I got my supplies. I have all of them.');
    });

    test('index.js exports the new names', () => {
        for (const name of ['entranceAllowed', 'tripStart', 'ENTRANCE_DISTANCE', 'ENTRANCE_AREA_TYPES', 'askMineText', 'suppliesText',
            'suppliesStoppedText', 'PROPOSAL_MS']) {
            assert.ok(P[name] !== undefined, `index.js must export ${name}`);
        }
    });
});

describe('mineOre without a known mine asks and does nothing (E4)', () => {
    function watchTools(s) {
        const calls = [];
        s.ctx.tools = {
            async ensureTool(...a) { calls.push(['ensureTool', a[2]]); return { ok: false, text: '' }; },
            async craftSupplies(...a) { calls.push(['craftSupplies', a[2]]); return { ok: false, text: '' }; },
        };
        s.ctx.storage = { async fetchItem(...a) { calls.push(['fetchItem', a[2]]); return { ok: false, taken: 0 }; } };
        return calls;
    }

    test('the question names a place 16 blocks or more from the house; nothing dug, crafted or fetched', async () => {
        const s = await scene({ gear: { ladders: 0, torches: 0, chests: 0 } });
        s.ctx.places.remember('home', 3.5, 64, 6.5, 'overworld');
        const calls = watchTools(s);
        const r = await M.mineOre(s.bot, s.ctx, 'iron', 8, s.opts);
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'ask');
        const m = /^I know no mine for iron\. I can dig a new one at \((-?\d+), (-?\d+), (-?\d+)\), (\d+) blocks from your house\. Tell me to do it, or show me your mine\.$/.exec(r.text);
        assert.ok(m, r.text);
        const e = { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
        assert.equal(e.y, 64, 'on the ground');
        assert.ok(Math.hypot(e.x + 0.5 - 3.5, e.z + 0.5 - 6.5) >= 16);
        assert.ok(Math.abs(Number(m[4]) - Math.hypot(e.x + 0.5 - 3.5, e.z + 0.5 - 6.5)) <= 0.5, 'the distance to the place home');
        assert.equal(digs(s.bot), 0);
        assert.equal(places(s.bot), 0);
        assert.deepEqual(calls, []);
        assert.equal(s.ctx.mines.list().length, 0, 'no mine saved');
        assert.equal(s.bot.calls.filter(c => c[0] === 'goto').length, 0, 'the bot did not move');
    });

    test('the distance to the house is to the area of type home when there is one', async () => {
        const s = await scene();
        s.ctx.areas = [{ name: 'home', type: 'home', min: { x: 0, y: 63, z: 3 }, max: { x: 5, y: 68, z: 8 } }];
        const r = await M.mineOre(s.bot, s.ctx, 'coal', 2, s.opts);
        assert.equal(r.reason, 'ask');
        const m = /at \((-?\d+), (-?\d+), (-?\d+)\), (\d+) blocks from your house/.exec(r.text);
        assert.ok(m, r.text);
        const gap = (v, lo, hi) => (v < lo ? lo - v : v > hi ? v - hi : 0);
        const d = Math.hypot(gap(Number(m[1]) + 0.5, 0, 6), gap(Number(m[3]) + 0.5, 3, 9));
        assert.ok(d >= 16, `${d}`);
        assert.equal(Number(m[4]), Math.round(d));
    });

    test('without a house the question has no distance', async () => {
        const s = await scene();
        const r = await M.mineOre(s.bot, s.ctx, 'coal', 2, s.opts);
        assert.equal(r.reason, 'ask');
        assert.match(r.text, /^I know no mine for coal\. I can dig a new one at \(-?\d+, 64, -?\d+\)\. Tell me to do it, or show me your mine\.$/);
    });

    test('yes: the new mine is dug at the place of the question', async () => {
        const s = await scene();
        s.ctx.places.remember('home', 3.5, 64, 6.5, 'overworld');
        const ask = await M.mineOre(s.bot, s.ctx, 'coal', 2, s.opts);
        const m = /at \((-?\d+), (-?\d+), (-?\d+)\)/.exec(ask.text);
        s.bot.entity.position.x += 3; // the bot moved a little between the question and the answer
        s.ctx.settings = { mining_max_minutes: 2 };
        const r = await M.mineOre(s.bot, s.ctx, 'coal', 50, { ...s.opts, newMine: true });
        assert.ok(!['ask', 'underground', 'no_entrance'].includes(r.reason), r.text);
        assert.deepEqual(s.ctx.mines.get('coal').entrance, { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) });
        assert.ok(digs(s.bot) > 0);
    });

    test('a known mine is used without a question', async () => {
        const s = await scene();
        s.ctx.settings = { mining_max_minutes: 0.5 };
        const first = await M.mineOre(s.bot, s.ctx, 'coal', 50, { ...s.opts, newMine: true });
        assert.equal(first.reason, 'time', first.text);
        const again = await M.mineOre(s.bot, s.ctx, 'coal', 50, s.opts);
        assert.notEqual(again.reason, 'ask', again.text);
        assert.equal(s.ctx.mines.list().length, 1);
    });
});

describe('a new mine never starts underground (M4)', () => {
    test('mineOre with and without newMine, and descendToLevel: the text of the spec, nothing dug', async () => {
        const s = await scene({ pos: [0.5, 30, 0.5] });
        s.world.fill(-1, 30, -1, 1, 31, 1, 'air');
        s.ctx.whereAmI = () => ({ area: null, depth: 33, underground: true });
        for (const opts of [s.opts, { ...s.opts, newMine: true }]) {
            const r = await M.mineOre(s.bot, s.ctx, 'coal', 2, opts);
            assert.equal(r.ok, false);
            assert.equal(r.reason, 'underground');
            // v0.1.4.11, W3: the text names the next step (underground, in no mine the bot knows)
            assert.equal(r.text, 'I am underground, not in a mine I know. A new mine starts from the surface: say "leave the mine" or "go to the surface" first.');
        }
        const d = await M.descendToLevel(s.bot, s.ctx, 10, { ...s.opts, ore: 'coal' });
        assert.equal(d.reason, 'underground');
        assert.equal(d.text, 'I am underground, not in a mine I know. A new mine starts from the surface: say "leave the mine" or "go to the surface" first.', 'v0.1.4.11, W3');
        assert.equal(digs(s.bot), 0);
        assert.equal(s.ctx.mines.list().length, 0);
    });

    test('whereAmI that throws counts as the surface', async () => {
        const s = await scene();
        s.ctx.whereAmI = () => { throw new Error('x'); };
        const r = await M.mineOre(s.bot, s.ctx, 'coal', 2, s.opts);
        assert.equal(r.reason, 'ask');
    });
});

describe('prepareMiningTrip says what it gets and takes ladders only for the rest (M1, M2)', () => {
    test('a half-dug mine: 11 ladders for 10 blocks, a chest for the base; said through ctx.say', async () => {
        const s = await scene({ gear: { ladders: 0, chests: 0 } });
        const mine = {
            ore: 'coal', entrance: { x: 0, y: 64, z: 0 }, level: 40, base: null, chest: null, direction: 'north', length: 0, shaft: 'ladder',
            dimension: 'overworld', end: null, tunnel: [],
            route: [{ kind: 'ladder', x: 0, z: 0, top: 63, bottom: 50, face: 'north', entry: { x: 0, y: 64, z: 1 } }],
        };
        s.ctx.mines.set(mine);
        const fetched = [];
        s.ctx.storage = { async fetchItem(bot, ctx, name, n) { fetched.push([name, n]); return { ok: false, taken: 0 }; } };
        const said = [];
        s.ctx.say = t => said.push(t);
        const r = await M.prepareMiningTrip(s.bot, s.ctx, 'coal', s.opts);
        assert.equal(r.ok, true, r.text);
        assert.equal(r.level, 40);
        assert.deepEqual(said, ['I get my supplies: 11 ladders, a chest.']);
        assert.deepEqual(fetched, [['ladder', 11], ['chest', 1]]);
        assert.match(r.text, /I have 0 ladders for 10 blocks, the rest of the way down is a staircase\./);
    });

    test('without ctx.say the text goes to the log; with everything carried nothing is said', async () => {
        const s = await scene({ gear: { torches: 0 } });
        await M.prepareMiningTrip(s.bot, s.ctx, 'coal', s.opts);
        assert.ok(s.ctx.logs.includes('I get my supplies: 16 torches.'), JSON.stringify(s.ctx.logs));
        const full = await scene();
        const said = [];
        full.ctx.say = t => said.push(t);
        await M.prepareMiningTrip(full.bot, full.ctx, 'coal', full.opts);
        assert.deepEqual(said, []);
    });

    test('stopped while it gets its supplies: interrupted, and the text says what it still lacks', async () => {
        const s = await scene({ gear: { ladders: 0, torches: 0 } });
        s.ctx.storage = {
            async fetchItem(bot, ctx, name) {
                if (name === 'ladder') {
                    give(bot, 'ladder', 9);
                    bot.interrupt_code = true;
                }
                return { ok: true, taken: 9 };
            },
        };
        const r = await M.prepareMiningTrip(s.bot, s.ctx, 'coal', s.opts);
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'interrupted');
        assert.equal(r.text, 'I was stopped while I got my supplies. I still lack 16 torches.');
        s.bot.interrupt_code = false;
        const m = await M.mineOre(s.bot, s.ctx, 'coal', 2, { ...s.opts, newMine: true });
        assert.notEqual(m.reason, 'interrupted');
    });
});

describe('eatIfHungry sees the off-hand (E1 of the play test)', () => {
    async function hungryInMine({ offhand = true, viaCtx = false } = {}) {
        const s = await scene({ gear: { food: 0 } });
        const d = await M.descendToLevel(s.bot, s.ctx, 56, { ...s.opts, ore: 'coal' });
        assert.equal(d.ok, true, d.text);
        const b = await M.setupMineBase(s.bot, s.ctx, { ...s.opts, mine: d.mine });
        assert.equal(b.ok, true, b.text);
        const bread = { name: 'bread', count: 3, type: 0, slot: 45, stackSize: 64 };
        s.bot.inventory.slots = [];
        if (offhand) s.bot.inventory.slots[45] = bread;
        if (viaCtx) s.ctx.home = { foodItems: () => [bread] };
        s.bot.food = 5;
        s.ctx.settings = { mining_max_minutes: 0.5 };
        const r = await M.mineOre(s.bot, s.ctx, 'coal', 50, s.opts);
        return { s, r, bread };
    }

    test('bread only in slot 45: the trip eats it', async () => {
        const { s, bread } = await hungryInMine();
        assert.ok(s.bot.calls.some(c => c[0] === 'consume' && c[1] === 'bread'), JSON.stringify(s.bot.calls.filter(c => c[0] !== 'dig')));
        assert.ok(bread.count < 3);
    });

    test('foodItems of the home pack through ctx.home is used when the glue gives it', async () => {
        const { s } = await hungryInMine({ offhand: false, viaCtx: true });
        assert.ok(s.bot.calls.some(c => c[0] === 'consume' && c[1] === 'bread'));
    });

    test('no food at all: nothing is eaten and the trip goes back (hungry)', async () => {
        const { s, r } = await hungryInMine({ offhand: false });
        assert.equal(s.bot.calls.some(c => c[0] === 'consume'), false);
        assert.equal(r.reason, 'hungry', r.text);
        assert.equal(count(s.bot, 'bread'), 0);
    });
});
