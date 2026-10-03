// Spec v0.1.4.12, 4.4 (part B, engineer E4): the build. The order of the cells; the stand of the bot (beside a line, outside
// a fence, behind a gate against its facing, in the column before a cell of a tunnel); the area guard asked for every
// cell, a refused cell skipped and counted (at most 3 refusals in the answer, then "and N more"); the material fetched
// through ctx.storage.fetchItem after the `short` text; a stop keeps what is built and answers `stopped`.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { loadSrc } from '../helpers/load.js';

const L = await loadSrc('src/agent/packs/watch/pattern_logic.js');
const B = await loadSrc('src/agent/packs/watch/build.js');

const rec = (kind, name, x, y, z, t, props = {}) => ({ kind, name, x, y, z, t, props });
const key = (c) => `${c.x},${c.y},${c.z}`;
const LINE = [0, 1, 2, 3].map(i => rec('place', 'oak_planks', 10 + i, 64, 5, i));
const FENCE = [
    rec('place', 'oak_fence', 4, 64, -12, 1), rec('place', 'oak_fence', 4, 64, -13, 2), rec('place', 'oak_fence', 4, 64, -14, 3),
    rec('place', 'oak_fence_gate', 4, 64, -15, 4, { facing: 'east' }),
];
const TUNNEL = [];
for (let i = 0; i < 3; i++) TUNNEL.push(rec('break', 'stone', 20 - i, 40, 3, 2 * i), rec('break', 'stone', 20 - i, 41, 3, 2 * i + 1));

// a world: grass at 63, air above, stone below; and the blocks of the fixture
function makeWorld(blocks = {}) {
    const set = new Map(Object.entries(blocks));
    return {
        get: (x, y, z) => set.get(`${x},${y},${z}`) ?? (y > 63 ? 'air' : y === 63 ? 'grass_block' : 'stone'),
        set: (x, y, z, name) => set.set(`${x},${y},${z}`, name),
    };
}

// a bot in that world with an inventory and a fake guard; place, dig and walk recorded
function makeBot(world, { items = {}, refuse = () => false, areaOf = () => null, pos = [10, 64, 8] } = {}) {
    const inv = { ...items };
    const bot = {
        username: 'andy',
        entity: { position: new Vec3(...pos) },
        game: { gameMode: 'survival' },
        interrupt_code: false,
        blockAt: (p) => ({ name: world.get(p.x, p.y, p.z), position: new Vec3(p.x, p.y, p.z) }),
        inventory: { items: () => Object.entries(inv).filter(([, n]) => n > 0).map(([name, count]) => ({ name, count })) },
        areaGuard: {
            canPlace: (p, item) => !refuse(p, item),
            canBreak: (b) => !refuse(b.position, null),
            areaAt: (p) => areaOf(p),
        },
        inv,
    };
    return bot;
}

function makeTools(bot, world, log = { places: [], digs: [], walks: [] }) {
    let t = 0;
    return {
        log,
        options: {
            now: () => (t += 50),
            wait: async () => {},
            walk: async (b, stand) => {
                log.walks.push(key(stand));
                b.entity.position = new Vec3(stand.x + 0.5, stand.y, stand.z + 0.5);
                return { ok: true, reason: null };
            },
            place: async (b, name, x, y, z) => {
                log.places.push([name, key({ x, y, z })]);
                if ((bot.inv[name] ?? 0) < 1) return false;
                bot.inv[name]--;
                world.set(x, y, z, name);
                return true;
            },
            dig: async (b, x, y, z) => {
                log.digs.push(key({ x, y, z }));
                world.set(x, y, z, 'air');
                return true;
            },
        },
    };
}

const ctxWith = (extra = {}) => {
    const said = [];
    const logs = [];
    return { said, logs, say: (text) => said.push(text), log: (text) => logs.push(text), ...extra };
};

describe('buildSteps and standFor', () => {
    test('a line: one place per missing cell, along the line from the placed blocks', () => {
        const p = L.findPattern(LINE, '8 long', { blockAt: () => 'air' });
        assert.deepEqual(B.buildSteps(p).map(s => [s.action, s.name, key(s)]),
            [14, 15, 16, 17].map(x => ['place', 'oak_planks', `${x},64,5`]));
        assert.deepEqual(B.standFor(p, { x: 14, y: 64, z: 5 }, 'south'), { x: 14, y: 64, z: 7 });
        assert.equal(B.sideOfLine(p, { x: 11, y: 64, z: 9 }), 'south');
        assert.equal(B.sideOfLine(p, { x: 11, y: 64, z: 1 }), 'north');
    });

    test('a fence: around from the placed side; the stand outside the rectangle; a gate behind it against its facing', () => {
        const p = L.findPattern(FENCE, '7 by 10', { blockAt: () => 'air' });
        const steps = B.buildSteps(p);
        assert.equal(steps.length, 26);
        assert.deepEqual(steps.slice(0, 4).map(key), ['4,64,-16', '4,64,-17', '4,64,-18', '5,64,-18']);
        assert.deepEqual(B.standFor(p, { x: 4, y: 64, z: -16 }), { x: 2, y: 64, z: -16 }, 'west of the west side');
        assert.deepEqual(B.standFor(p, { x: 7, y: 64, z: -18 }), { x: 7, y: 64, z: -20 }, 'north of the north side');
        assert.deepEqual(B.standFor(p, { x: 13, y: 64, z: -15 }), { x: 15, y: 64, z: -15 }, 'east of the east side');
        assert.deepEqual(B.standFor(p, { x: 8, y: 64, z: -12 }), { x: 8, y: 64, z: -10 }, 'south of the south side');
        assert.deepEqual(B.standFor(p, { x: 4, y: 64, z: -15, facing: 'east' }), { x: 2, y: 64, z: -15 }, 'a gate facing east: 2 west of it');
    });

    test('a tunnel: feet then head, column after column; the stand in the column before', () => {
        const p = L.findPattern(TUNNEL, '5 long');
        assert.deepEqual(B.buildSteps(p).map(key), ['17,40,3', '17,41,3', '16,40,3', '16,41,3']);
        assert.deepEqual(B.standFor(p, { x: 17, y: 40, z: 3 }), { x: 18, y: 40, z: 3 });
    });
});

describe('buildPattern: a line', () => {
    test('the 8 cells in order, from beside the line; `I built the line: 8 oak_planks.`', async () => {
        const world = makeWorld();
        LINE.forEach(e => world.set(e.x, e.y, e.z, 'oak_planks'));
        const bot = makeBot(world, { items: { oak_planks: 20 } });
        const p = L.findPattern(LINE, '12 long', { blockAt: (x, y, z) => world.get(x, y, z) });
        const { options, log } = makeTools(bot, world);
        const ctx = ctxWith();
        const r = await B.buildPattern(bot, ctx, p, options);
        assert.deepEqual(r, { ok: true, reason: null, text: 'I built the line: 8 oak_planks.', built: 8, refused: 0, total: 8 });
        assert.deepEqual(log.places.map(([, k]) => k), [14, 15, 16, 17, 18, 19, 20, 21].map(x => `${x},64,5`));
        assert.ok(log.walks.every(k => k.endsWith(',64,7')), `the bot walks south of the line: ${log.walks}`);
        assert.deepEqual(ctx.said, [], 'no short text');
        assert.equal(bot.inv.oak_planks, 12);
    });

    test('the guard refuses 5 cells: they are skipped and counted, 3 named, "and 2 more"', async () => {
        const world = makeWorld();
        const bot = makeBot(world, { items: { oak_planks: 20 }, refuse: (p) => p.x >= 17, areaOf: () => ({ name: 'pen', type: 'pen' }) });
        const p = L.findPattern(LINE, '12 long', { blockAt: () => 'air' });
        const { options, log } = makeTools(bot, world);
        const r = await B.buildPattern(bot, ctxWith(), p, options);
        assert.deepEqual(log.places.map(([, k]) => k), ['14,64,5', '15,64,5', '16,64,5'], 'nothing placed in a refused cell');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'refused');
        assert.equal(r.refused, 5);
        assert.equal(r.built, 3);
        assert.equal(r.text, 'I built the line: 3 oak_planks. I placed nothing at (17, 64, 5): it is inside the area "pen". I placed nothing at (18, 64, 5): it is inside the area "pen". I placed nothing at (19, 64, 5): it is inside the area "pen", and 2 more.');
    });

    test('a block in the way is not broken: the cell is skipped and named', async () => {
        const world = makeWorld({ '15,64,5': 'stone' });
        const bot = makeBot(world, { items: { oak_planks: 20 } });
        const p = L.findPattern(LINE, '6 long', { blockAt: () => 'air' });
        const { options, log } = makeTools(bot, world);
        const r = await B.buildPattern(bot, ctxWith(), p, options);
        assert.deepEqual(log.places.map(([, k]) => k), ['14,64,5']);
        assert.equal(r.text, 'I built the line: 1 oak_planks. I placed nothing at (15, 64, 5): stone is in the way.');
        assert.equal(world.get(15, 64, 5), 'stone');
    });

    test('a stop keeps what is built: `I stopped after 2 of 8.`', async () => {
        const world = makeWorld();
        const bot = makeBot(world, { items: { oak_planks: 20 } });
        const p = L.findPattern(LINE, '12 long', { blockAt: () => 'air' });
        const { options, log } = makeTools(bot, world);
        const place = options.place;
        options.place = async (...args) => {
            const ok = await place(...args);
            if (log.places.length === 2) bot.interrupt_code = true;
            return ok;
        };
        const r = await B.buildPattern(bot, ctxWith(), p, options);
        assert.deepEqual(r, { ok: false, reason: 'interrupted', text: 'I stopped after 2 of 8.', built: 2, refused: 0, total: 8 });
        assert.equal(world.get(14, 64, 5), 'oak_planks');
        assert.equal(world.get(15, 64, 5), 'oak_planks');
    });
});

describe('buildPattern: a fence with the material from the chest', () => {
    test('short: the short text first, fetchItem for the rest, then the fence', async () => {
        const world = makeWorld();
        FENCE.forEach(e => world.set(e.x, e.y, e.z, e.name));
        const bot = makeBot(world, { items: { oak_fence: 12 }, pos: [1, 64, -13] });
        const fetches = [];
        const ctx = ctxWith({ storage: { fetchItem: async (name, n) => { fetches.push([name, n]); bot.inv[name] += n; return { ok: true }; } } });
        const p = L.findPattern(FENCE, '7 by 10', { blockAt: (x, y, z) => world.get(x, y, z) });
        const { options, log } = makeTools(bot, world);
        const r = await B.buildPattern(bot, ctx, p, options);
        assert.deepEqual(ctx.said, ['I have 12 oak_fence and need 26. I fetch the rest from the chest.']);
        assert.deepEqual(fetches, [['oak_fence', 14]]);
        assert.equal(r.text, 'I built the fence: 26 oak_fence. Say "this is the pen" to save it.');
        assert.equal(log.places.length, 26);
        assert.ok(log.places.every(([name]) => name === 'oak_fence'));
        assert.equal(world.get(4, 64, -15), 'oak_fence_gate', 'the gate stays');
    });

    test('nothing more in the chests: `... I found no more in the chests; I built 12 of 26.`', async () => {
        const world = makeWorld();
        FENCE.forEach(e => world.set(e.x, e.y, e.z, e.name));
        const bot = makeBot(world, { items: { oak_fence: 12 }, pos: [1, 64, -13] });
        const ctx = ctxWith({ storage: { fetchItem: async () => ({ ok: false, reason: 'not_found' }) } });
        const p = L.findPattern(FENCE, '7 by 10', { blockAt: (x, y, z) => world.get(x, y, z) });
        const { options } = makeTools(bot, world);
        const r = await B.buildPattern(bot, ctx, p, options);
        assert.equal(r.reason, 'short');
        assert.equal(r.text, 'I have 12 oak_fence and need 26. I found no more in the chests; I built 12 of 26.');
    });

    test('a gate of the bot: placed from behind it, so it faces inward', async () => {
        const world = makeWorld();
        FENCE.slice(0, 3).forEach(e => world.set(e.x, e.y, e.z, e.name));
        const bot = makeBot(world, { items: { oak_fence: 64, oak_fence_gate: 1 }, pos: [1, 64, -13] });
        const p = L.findPattern(FENCE.slice(0, 3), '4 by 4', { blockAt: (x, y, z) => world.get(x, y, z), player: { x: 6, y: 64, z: -18 } });
        const gate = p.cells.find(c => c.name === 'oak_fence_gate');
        const { options, log } = makeTools(bot, world);
        const walk = options.walk;
        let standAtGate = null;
        options.walk = async (b, stand, range) => {
            const r = await walk(b, stand, range);
            standAtGate = stand;
            return r;
        };
        const place = options.place;
        options.place = async (b, name, x, y, z) => {
            if (name === 'oak_fence_gate') assert.deepEqual(standAtGate, B.standFor(p, gate));
            return await place(b, name, x, y, z);
        };
        const r = await B.buildPattern(bot, ctxWith(), p, options);
        assert.ok(log.places.some(([name]) => name === 'oak_fence_gate'));
        assert.match(r.text, /^I built the fence: \d+ oak_fence and 1 gate\. Say "this is the pen" to save it\.$/);
    });
});

describe('buildPattern: a tunnel', () => {
    test('the cells dug in order; `I dug the tunnel: 9 blocks.`', async () => {
        const blocks = {};
        TUNNEL.forEach(e => { blocks[key(e)] = 'air'; });
        const world = makeWorld(blocks);
        const bot = makeBot(world, { pos: [19, 40, 3] });
        const p = L.findPattern(TUNNEL, '12 long', { blockAt: (x, y, z) => world.get(x, y, z) });
        const { options, log } = makeTools(bot, world);
        const r = await B.buildPattern(bot, ctxWith(), p, options);
        assert.equal(r.text, 'I dug the tunnel: 9 blocks.');
        assert.deepEqual(log.digs.slice(0, 4), ['17,40,3', '17,41,3', '16,40,3', '16,41,3']);
        assert.equal(log.digs.length, 18);
        assert.equal(world.get(17, 39, 3), 'stone', 'the floor stands');
        assert.equal(world.get(17, 42, 3), 'stone', 'the ceiling stands');
    });

    test('canBreak refuses a column; lava next to a block', async () => {
        const blocks = {};
        TUNNEL.forEach(e => { blocks[key(e)] = 'air'; });
        blocks['14,40,4'] = 'lava';
        const world = makeWorld(blocks);
        const bot = makeBot(world, { pos: [19, 40, 3], refuse: (pos) => pos.x === 16, areaOf: () => ({ name: 'home', type: 'home' }) });
        const p = L.findPattern(TUNNEL, '7 long', { blockAt: (x, y, z) => world.get(x, y, z) });
        const { options, log } = makeTools(bot, world);
        const r = await B.buildPattern(bot, ctxWith(), p, options);
        assert.ok(!log.digs.some(k => k.startsWith('16,') || k === '14,40,3'));
        assert.equal(r.text, 'I dug the tunnel: 2 blocks. I dug nothing at (16, 40, 3): it is inside the area "home". I dug nothing at (14, 40, 3): lava is next to it.');
        assert.equal(r.refused, 2);
    });
});

describe('buildPattern without a pattern', () => {
    test('`I have no plan. Say "continue like this" first.`', async () => {
        assert.equal((await B.buildPattern({}, {}, null)).text, 'I have no plan. Say "continue like this" first.');
        assert.equal((await B.buildPattern({}, {}, { kind: null, why: 'no_line' })).text, 'I have no plan. Say "continue like this" first.');
    });
});
