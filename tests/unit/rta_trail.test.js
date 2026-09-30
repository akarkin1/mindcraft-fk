// Spec v0.1.4.9, part A (engineer E1): the trail recorder (I1, A1) on a fake bot: a step per new feet cell,
// the last maxSteps, trail.json written at most every 5 s and at stop(), an interval that is unref()ed and
// cleared by stop(), a teleport or a new dimension starts the trail again, tick() never throws.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';

const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
const TR = await loadSrc('src/agent/packs/routes/trail.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

// A flat world: stone at y 63 and below, air above with sky light 15; `blocks` overrides "x,y,z".
function fakeBot({ blocks = {}, pos = [0.5, 64, 0.5] } = {}) {
    const bot = {
        entity: { position: new Vec3(...pos), onGround: true, isInWater: false },
        game: { dimension: 'minecraft:overworld' },
        blockAt(p) {
            const b = blocks[`${p.x},${p.y},${p.z}`];
            if (b) return { skyLight: 15, boundingBox: 'block', getProperties: () => b.props ?? {}, ...b };
            return p.y <= 63 ? { name: 'stone', boundingBox: 'block', skyLight: 0 } : { name: 'air', boundingBox: 'empty', skyLight: 15 };
        },
    };
    bot.moveTo = (x, y, z) => { bot.entity.position = new Vec3(x, y, z); };
    return bot;
}

function clock(start = 1000) {
    const c = { t: start, now: () => c.t };
    return c;
}

describe('createTrail', () => {
    test('a step per new feet cell, none while the bot falls; list gives copies', () => {
        const bot = fakeBot();
        const c = clock();
        const trail = TR.createTrail(bot, {}, { now: c.now });
        trail.tick();
        trail.tick();
        bot.moveTo(1.2, 64, 0.5);
        c.t += 250;
        trail.tick();
        bot.entity.onGround = false;
        bot.moveTo(2.5, 66.3, 0.5);
        trail.tick();
        assert.equal(trail.size, 2);
        const list = trail.list();
        assert.deepEqual(list[1], { x: 1, y: 64, z: 0, on: 'stone', at: 'air', sky: true, t: 1250, via: null });
        list[0].x = 99;
        assert.equal(trail.list()[0].x, 0);
    });

    test('the oldest steps leave at maxSteps', () => {
        const bot = fakeBot();
        const trail = TR.createTrail(bot, {}, { maxSteps: 50 });
        for (let x = 0; x < 80; x++) {
            bot.moveTo(x + 0.5, 64, 0.5);
            trail.tick();
        }
        assert.equal(trail.size, 50);
        assert.equal(trail.list()[0].x, 30);
        assert.equal(trail.list()[49].x, 79);
    });

    test('via and sky from the world: a door of the house, a roof', () => {
        const blocks = {
            '4,64,7': { name: 'oak_door', props: { half: 'lower', facing: 'south', open: true } },
            '4,65,7': { name: 'oak_door', props: { half: 'upper', facing: 'south', open: true } },
            '4,64,5': { name: 'air', boundingBox: 'empty', skyLight: 0 },
            '4,68,5': { name: 'oak_planks', skyLight: 0 },
        };
        const bot = fakeBot({ blocks, pos: [4.5, 64, 8.5] });
        const trail = TR.createTrail(bot, {});
        trail.tick();
        bot.moveTo(4.5, 64, 7.5);
        trail.tick();
        bot.moveTo(4.5, 64, 5.5);
        trail.tick();
        const [outside, door, inside] = trail.list();
        assert.equal(outside.via, null);
        assert.equal(outside.sky, true);
        assert.deepEqual(door.via, { kind: 'door', name: 'oak_door', x: 4, y: 64, z: 7 });
        assert.equal(inside.sky, false, 'sky light 0 and a roof above');
        assert.deepEqual(inside.via, { kind: 'door', name: 'oak_door', x: 4, y: 64, z: 7 }, 'the door was at the last cell');
    });

    test('a teleport of more than 16 blocks or another dimension starts the trail again', () => {
        const bot = fakeBot();
        const trail = TR.createTrail(bot, {});
        trail.tick();
        bot.moveTo(1.5, 64, 0.5);
        trail.tick();
        bot.moveTo(40.5, 64, 0.5);
        trail.tick();
        assert.deepEqual(trail.list().map(s => s.x), [40]);
        bot.game.dimension = 'minecraft:the_nether';
        bot.moveTo(41.5, 64, 0.5);
        trail.tick();
        assert.deepEqual(trail.list().map(s => s.x), [41]);
    });

    test('tick never throws; clear empties the trail', () => {
        const bot = fakeBot();
        const trail = TR.createTrail(bot, {});
        trail.tick();
        bot.blockAt = () => { throw new Error('the world is gone'); };
        bot.moveTo(3.5, 64, 0.5);
        assert.doesNotThrow(() => trail.tick());
        bot.entity = null;
        assert.doesNotThrow(() => trail.tick());
        trail.clear();
        assert.equal(trail.size, 0);
    });

    test('trail.json: { version: 1, steps }, written at most every 5 s and at stop(), read back', () => {
        const dir = makeTmpDir();
        try {
            const file = path.join(dir, TR.TRAIL_FILE);
            const bot = fakeBot();
            const c = clock();
            const trail = TR.createTrail(bot, {}, { file, now: c.now });
            const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
            trail.tick();
            assert.equal(read().version, 1);
            assert.equal(read().steps.length, 1);
            for (let x = 1; x <= 3; x++) {
                c.t += 1000;
                bot.moveTo(x + 0.5, 64, 0.5);
                trail.tick();
            }
            assert.equal(read().steps.length, 1, 'not yet: 3 s');
            c.t += 2000;
            bot.moveTo(4.5, 64, 0.5);
            trail.tick();
            assert.equal(read().steps.length, 5, 'after 5 s');
            bot.moveTo(5.5, 64, 0.5);
            trail.tick();
            trail.stop();
            assert.deepEqual(read().steps.map(s => s.x), [0, 1, 2, 3, 4, 5], 'in order, at stop()');
            const again = TR.createTrail(bot, {}, { file, maxSteps: 4 });
            assert.deepEqual(again.list().map(s => s.x), [2, 3, 4, 5]);
        } finally {
            removeTmpDir(dir);
        }
    });

    test('a corrupt file: an empty trail', () => {
        const dir = makeTmpDir();
        try {
            const file = path.join(dir, 'trail.json');
            fs.writeFileSync(file, '{ broken');
            assert.equal(TR.createTrail(fakeBot(), {}, { file }).size, 0);
        } finally {
            removeTmpDir(dir);
        }
    });

    test('start() looks every intervalMs; stop() clears the interval (the file ends by itself)', async () => {
        const bot = fakeBot();
        const trail = TR.createTrail(bot, {}, { intervalMs: 5 });
        trail.start();
        trail.start();
        assert.equal(trail.running, true);
        for (let x = 1; x <= 3; x++) {
            bot.moveTo(x + 0.5, 64, 0.5);
            await new Promise(r => setTimeout(r, 25));
        }
        trail.stop();
        assert.equal(trail.running, false);
        assert.deepEqual(trail.list().map(s => s.x), [1, 2, 3]);
        bot.moveTo(9.5, 64, 0.5);
        await new Promise(r => setTimeout(r, 25));
        assert.equal(trail.size, 3, 'no look after stop()');
    });

    test('the facing of a ladder for the legs', () => {
        const bot = fakeBot({ blocks: { '2,50,-2': { name: 'ladder', props: { facing: 'south' } } } });
        const faceAt = TR.ladderFacingReader(bot);
        assert.equal(faceAt(2, 50, -2), 'south');
        assert.equal(faceAt(2, 70, -2), null);
    });
});
