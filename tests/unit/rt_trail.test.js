// T1, spec v0.1.4.9 I1 and A1: the trail. createTrail(bot, ctx, { file, maxSteps, intervalMs, saveMs, now, wait })
// -> { start, stop, tick, list, clear, size }. A step is { x, y, z, on, at, sky, t, via }. The rules of a step:
// a new step when the feet cell changes; nothing while the bot is not on the ground, not on a ladder and not in
// water; sky from the sky light at the feet (15 is open sky), without sky light no solid block within 64 above;
// via for a door, gate or trapdoor at the feet, at the last cell or between them, a trapdoor also right above or
// below the feet. The file { version: 1, steps } is written at most every 5 s and at stop(); the oldest steps
// leave at maxSteps; the interval of start() is unref()ed and stop() clears it (this file ends by itself).
// Handoff: a sky light of 0 counts as missing.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { makeWorld, makeMiningBot } from './mining_fake_bot.test.js';

const TR = await loadSrc('src/agent/packs/routes/trail.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

// A bot on grass at y 63 (feet 64); the sky light is 15 above the ground unless `sky` says otherwise.
function scene({ sky = null, groundY = 63 } = {}) {
    const world = makeWorld({ groundY });
    const bot = makeMiningBot({ world, pos: [0.5, groundY + 1, 0.5] });
    const blockAt = bot.blockAt;
    bot.blockAt = (p) => {
        const b = blockAt(p);
        if (b) b.skyLight = sky ? sky(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) : (Math.floor(p.y) > groundY ? 15 : 0);
        return b;
    };
    let t = 1000;
    const clock = { now: () => t, advance: (ms) => { t += ms; } };
    return { world, bot, clock };
}
const moveTo = (bot, x, y, z, { onGround = true } = {}) => {
    bot.entity.position.x = x + 0.5;
    bot.entity.position.y = y;
    bot.entity.position.z = z + 0.5;
    bot.entity.onGround = onGround;
};
const cells = (trail) => trail.list().map((s) => [s.x, s.y, s.z]);

describe('I1: the steps', () => {
    test('a step: the feet cell, the block under and at the feet, sky, t, via null', () => {
        const s = scene();
        const trail = TR.createTrail(s.bot, {}, { file: null, now: s.clock.now });
        trail.tick();
        const [step] = trail.list();
        assert.deepEqual({ x: step.x, y: step.y, z: step.z }, { x: 0, y: 64, z: 0 });
        assert.equal(step.on, 'grass_block');
        assert.equal(step.at, 'air');
        assert.equal(step.sky, true);
        assert.equal(step.t, 1000);
        assert.equal(step.via, null);
        assert.equal(trail.size, 1);
    });

    test('a new step only when the feet cell changes (Math.floor of x, y, z)', () => {
        const s = scene();
        const trail = TR.createTrail(s.bot, {}, { file: null, now: s.clock.now });
        trail.tick();
        s.bot.entity.position.x = 0.9;
        trail.tick();
        assert.equal(trail.size, 1, 'the same cell');
        moveTo(s.bot, 1, 64, 0);
        trail.tick();
        moveTo(s.bot, 1, 64, -1);
        trail.tick();
        assert.deepEqual(cells(trail), [[0, 64, 0], [1, 64, 0], [1, 64, -1]]);
    });

    test('a fall is no step: not on the ground, not on a ladder, not in water', () => {
        const s = scene();
        const trail = TR.createTrail(s.bot, {}, { file: null, now: s.clock.now });
        trail.tick();
        moveTo(s.bot, 0, 70, 0, { onGround: false });
        trail.tick();
        moveTo(s.bot, 0, 67, 0, { onGround: false });
        trail.tick();
        assert.deepEqual(cells(trail), [[0, 64, 0]]);
    });

    test('on a ladder, off the ground: a step with at "ladder"', () => {
        const s = scene();
        s.world.fill(3, 64, 0, 3, 70, 0, 'ladder', { facing: 'west' });
        const trail = TR.createTrail(s.bot, {}, { file: null, now: s.clock.now });
        moveTo(s.bot, 3, 66, 0, { onGround: false });
        trail.tick();
        moveTo(s.bot, 3, 67, 0, { onGround: false });
        trail.tick();
        assert.deepEqual(cells(trail), [[3, 66, 0], [3, 67, 0]]);
        assert.equal(trail.list()[0].at, 'ladder');
    });

    test('in water, off the ground: a step', () => {
        const s = scene();
        s.world.fill(5, 60, 5, 8, 64, 8, 'water');
        const trail = TR.createTrail(s.bot, {}, { file: null, now: s.clock.now });
        moveTo(s.bot, 6, 62, 6, { onGround: false });
        s.bot.entity.isInWater = true;
        trail.tick();
        assert.deepEqual(cells(trail), [[6, 62, 6]]);
        assert.equal(trail.list()[0].at, 'water');
    });

    // fix round 2, decision F5 (E1): this test read "sky from the sky light at the feet: 15 open sky, less not"; the
    // trail no longer reads the sky light (it was stale on the server), the column of 64 blocks decides
    test('decision F5: the sky light is never read, the column of 64 blocks decides', () => {
        const s = scene({ sky: (x) => (x === 10 ? 12 : 15) });
        s.world.set(20, 70, 0, 'stone'); // a roof over x 20, where the stale light says 15
        const trail = TR.createTrail(s.bot, {}, { file: null, now: s.clock.now });
        trail.tick();
        moveTo(s.bot, 10, 64, 0);
        trail.tick();
        moveTo(s.bot, 20, 64, 0);
        trail.tick();
        assert.deepEqual(trail.list().map((st) => st.sky), [true, true, false]);
    });

    test('without a sky light: open sky when no solid block is in the column above within 64 blocks', () => {
        const s = scene({ sky: () => undefined });
        s.world.set(4, 90, 0, 'stone'); // 26 above the feet of x 4
        s.world.set(6, 140, 0, 'stone'); // 76 above the feet of x 6: beyond 64
        const trail = TR.createTrail(s.bot, {}, { file: null, now: s.clock.now });
        trail.tick();
        moveTo(s.bot, 4, 64, 0);
        trail.tick();
        moveTo(s.bot, 6, 64, 0);
        trail.tick();
        assert.deepEqual(trail.list().map((st) => st.sky), [true, false, true]);
    });

    test('handoff: a sky light of 0 counts as missing, the column decides', () => {
        const s = scene({ sky: () => 0 });
        const trail = TR.createTrail(s.bot, {}, { file: null, now: s.clock.now });
        trail.tick();
        assert.equal(trail.list()[0].sky, true);
    });

    test('via: a door at the feet cell, a fence gate, a trapdoor right above the feet', () => {
        const s = scene();
        s.world.set(1, 64, 0, 'oak_door', { half: 'lower', open: true, facing: 'east', hinge: 'left' });
        s.world.set(1, 65, 0, 'oak_door', { half: 'upper', open: true, facing: 'east', hinge: 'left' });
        s.world.set(3, 64, 0, 'oak_fence_gate', { open: true, facing: 'east' });
        s.world.set(5, 66, 0, 'oak_trapdoor', { open: true, half: 'bottom', facing: 'east' });
        const trail = TR.createTrail(s.bot, {}, { file: null, now: s.clock.now });
        for (let x = 0; x <= 6; x++) {
            moveTo(s.bot, x, 64, 0);
            trail.tick();
        }
        const steps = trail.list();
        const via = (x) => steps.find((st) => st.x === x)?.via ?? null;
        assert.deepEqual(via(1), { kind: 'door', name: 'oak_door', x: 1, y: 64, z: 0 });
        assert.deepEqual(via(3), { kind: 'gate', name: 'oak_fence_gate', x: 3, y: 64, z: 0 });
        assert.equal(via(0), null);
        assert.equal(via(5), null, 'the trapdoor two blocks above the feet is not passed');
        s.world.set(5, 65, 0, 'oak_trapdoor', { open: true, half: 'bottom', facing: 'east' });
        const trail2 = TR.createTrail(s.bot, {}, { file: null, now: s.clock.now });
        moveTo(s.bot, 4, 64, 0);
        trail2.tick();
        moveTo(s.bot, 5, 64, 0);
        trail2.tick();
        assert.deepEqual(trail2.list()[1].via, { kind: 'trapdoor', name: 'oak_trapdoor', x: 5, y: 65, z: 0 });
    });

    test('via: a door between the last cell and the feet (the bot passed it within one read)', () => {
        const s = scene();
        s.world.set(1, 64, 0, 'oak_door', { half: 'lower', open: true, facing: 'east', hinge: 'left' });
        const trail = TR.createTrail(s.bot, {}, { file: null, now: s.clock.now });
        trail.tick();
        moveTo(s.bot, 2, 64, 0);
        trail.tick();
        assert.deepEqual(trail.list()[1].via, { kind: 'door', name: 'oak_door', x: 1, y: 64, z: 0 });
    });

    test('tick() never throws: a bot without a body, a world that throws', () => {
        const s = scene();
        const trail = TR.createTrail(s.bot, {}, { file: null, now: s.clock.now });
        s.bot.blockAt = () => { throw new Error('no world'); };
        assert.doesNotThrow(() => trail.tick());
        const bodiless = TR.createTrail({ entity: null }, {}, { file: null, now: s.clock.now });
        assert.doesNotThrow(() => bodiless.tick());
        assert.equal(bodiless.size, 0);
    });
});

describe('I1: maxSteps, clear, the file, start and stop', () => {
    let dir;
    before(() => {
        dir = makeTmpDir();
    });
    after(() => removeTmpDir(dir));

    test('the oldest steps leave at maxSteps (default 500)', () => {
        const s = scene();
        const trail = TR.createTrail(s.bot, {}, { file: null, now: s.clock.now, maxSteps: 50 });
        for (let x = 0; x < 60; x++) {
            moveTo(s.bot, x, 64, 0);
            trail.tick();
        }
        assert.equal(trail.size, 50);
        assert.equal(trail.list()[0].x, 10);
        assert.equal(trail.list().at(-1).x, 59);
        const def = TR.createTrail(s.bot, {}, { file: null, now: s.clock.now });
        for (let x = 0; x < 520; x++) {
            moveTo(s.bot, x, 64, 0);
            def.tick();
        }
        assert.equal(def.size, 500);
    });

    test('clear empties the trail', () => {
        const s = scene();
        const trail = TR.createTrail(s.bot, {}, { file: null, now: s.clock.now });
        trail.tick();
        trail.clear();
        assert.equal(trail.size, 0);
        assert.deepEqual(trail.list(), []);
    });

    test('the file: { version: 1, steps }, written at most every 5 s and at stop()', () => {
        const s = scene();
        const file = path.join(dir, 'trail.json');
        const trail = TR.createTrail(s.bot, {}, { file, now: s.clock.now });
        const saved = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).steps.length : 0);
        trail.tick();
        const first = saved();
        assert.ok(first <= 1, `after the first step the file holds ${first}`);
        s.clock.advance(1000);
        moveTo(s.bot, 1, 64, 0);
        trail.tick();
        s.clock.advance(1000);
        moveTo(s.bot, 2, 64, 0);
        trail.tick();
        assert.equal(saved(), first, 'no second write within 5 s');
        trail.start();
        trail.stop();
        const json = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.equal(json.version, 1);
        assert.deepEqual(json.steps.map((st) => [st.x, st.y, st.z]), [[0, 64, 0], [1, 64, 0], [2, 64, 0]]);
    });

    test('the file is read at creation (handoff): a new trail goes on with the saved steps', () => {
        const s = scene();
        const file = path.join(dir, 'again.json');
        const a = TR.createTrail(s.bot, {}, { file, now: s.clock.now });
        a.tick();
        moveTo(s.bot, 1, 64, 0);
        a.tick();
        a.stop();
        const b = TR.createTrail(s.bot, {}, { file, now: s.clock.now });
        assert.deepEqual(cells(b), [[0, 64, 0], [1, 64, 0]]);
    });

    test('start() records with the interval; stop() ends it; the interval does not keep the process alive', async () => {
        const s = scene();
        const trail = TR.createTrail(s.bot, {}, { file: null, now: s.clock.now, intervalMs: 5 });
        trail.start();
        await new Promise((r) => setTimeout(r, 30));
        moveTo(s.bot, 3, 64, 0);
        await new Promise((r) => setTimeout(r, 30));
        trail.stop();
        const size = trail.size;
        assert.ok(size >= 2, `recorded ${size} steps`);
        moveTo(s.bot, 4, 64, 0);
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(trail.size, size, 'nothing after stop()');
    });

    test('without a file the trail lives in memory: no trail.json anywhere', () => {
        const s = scene();
        const cwd = process.cwd();
        const empty = makeTmpDir();
        process.chdir(empty);
        try {
            const trail = TR.createTrail(s.bot, {}, { file: null, now: s.clock.now });
            trail.tick();
            trail.start();
            trail.stop();
            assert.deepEqual(fs.readdirSync(empty), []);
        } finally {
            process.chdir(cwd);
            removeTmpDir(empty);
        }
    });
});
