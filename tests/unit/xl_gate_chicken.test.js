// v0.1.4.14, fix round (engineer E4): W94 place_from_sentence on 26.1, check 4 "the gate of the pen is closed". The
// bot walked out of the pen through the gate it opened; the watch of the door service decided "close" on three looks
// (the feet out of the gate cell), but the service's click (closeOne of createDoorService) still held back on
// somebodyNear: a chicken inside the pen, diagonal to the gate (413.2, 5.3 beside the gate at 412, 4), within 1 block.
// Once the bot was more than 5 blocks away the gate was out of reach and stood open. The watch had stopped holding a
// gate for an animal beside it in v0.1.4.11 (F2, occupiedBy); the click now holds by the same rule: a gate only for
// somebody in its cell, a door or trapdoor for somebody within 1 block, as before. On the fake bot of the home pack.
// The second cause of the same runs: a cow or a chicken inside the pen pressed against the bar of the closed gate (the
// cow at 412.98, 5.075, 0.9 wide; a chicken at 412.03, 4.825) overlapped the gate's cell, counted as standing in the
// gate and held it. Now an entity holds a fence gate only when its box goes into the bar the closed gate fills.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeFakeBot, addMob, v } from './home_fake_bot.test.js';

const D = await loadSrc('src/agent/packs/home/doors.js');

// the pen x 608..616, z 4..12 with its gate in the middle of the north fence; the bot inside
function scene({ name = 'oak_fence_gate', props = { facing: 'south', open: true } } = {}) {
    const world = makeWorld();
    world.set(612, 61, 4, name, props);
    const bot = makeFakeBot({ world, pos: [612.5, 61, 8.5] });
    bot.areaGuard = { areaAt: p => (p.x >= 608 && p.x <= 617 && p.z >= 4 && p.z <= 13 ? { name: 'aviary', type: 'pen' } : null) };
    let t = 1_000_000;
    const clock = { now: () => t, wait: async (ms) => { t += Math.max(ms, 1); await Promise.resolve(); } };
    const service = D.createDoorService(bot, { areas: [], settings: { home_pack: true }, now: clock.now, log: () => {} },
        { now: clock.now, wait: clock.wait, checkMs: 40 });
    const step = async (pos, ms = 250) => {
        if (pos) bot.entity.position = v(...pos);
        t += ms;
        service.tick();
        await new Promise(r => setTimeout(r, 5));
    };
    return { world, bot, step, service, isOpen: () => world.propsAt(612, 61, 4).open === true };
}

// the walk of W94: inside, in the gate cell, then out and away along the fence to the west
async function walkOut(s) {
    await s.step();
    await s.step([612.5, 61, 4.5]);
    await s.step([611.8, 61, 3.6]);
    await s.step([610.2, 61, 3.5]);
    await s.step([608.6, 61, 3.5]);
}

describe('W94 on 26.1: a chicken beside the gate of the pen', () => {
    test('a chicken inside the pen, diagonal to the gate: the bot walks out and the gate is closed', async () => {
        const s = scene();
        // where the chicken stood in the failing run, 0.4 wide as a chicken of the server
        addMob(s.bot, 'chicken', [613.175, 61, 5.274], { type: 'animal' }).width = 0.4;
        assert.equal(D.somebodyNear(s.bot, { x: 612, y: 61, z: 4, kind: 'gate' }), true, 'the chicken is within 1 block');
        await walkOut(s);
        for (let i = 0; i < 10 && s.isOpen(); i++) await s.step();
        assert.equal(s.isOpen(), false);
        s.service.stop();
    });

    test('a chicken in the gate cell still holds it', async () => {
        const s = scene();
        addMob(s.bot, 'chicken', [612.5, 61, 4.5], { type: 'animal' }).width = 0.4;
        await walkOut(s);
        for (let i = 0; i < 10; i++) await s.step();
        assert.equal(s.isOpen(), true);
        s.service.stop();
    });
});

describe('W94 on 26.1: an animal pressed against the bar of the gate', () => {
    const GATE = { x: 612, y: 61, z: 4, kind: 'gate', facing: 'south' };
    const mob = (s, name, pos, width) => { addMob(s.bot, name, pos, { type: 'animal' }).width = width; };

    test('where the animals stood in the failing runs: not in the gate', () => {
        const s = scene();
        mob(s, 'cow', [612.984, 61, 5.075], 0.9);
        mob(s, 'chicken', [612.028, 61, 4.825], 0.4);
        mob(s, 'chicken', [613.18, 61, 4.825], 0.4);
        assert.equal(D.somebodyInDoor(s.bot, GATE), false);
        assert.equal(D.occupiedBy(s.bot, GATE), false);
        s.service.stop();
    });

    test('a chicken in the middle of the gate, a cow halfway through it: in the gate', () => {
        const s = scene();
        mob(s, 'chicken', [612.5, 61, 4.5], 0.4);
        assert.equal(D.somebodyInDoor(s.bot, GATE), true);
        const t = scene();
        mob(t, 'cow', [612.5, 61, 4.9], 0.9);
        assert.equal(D.somebodyInDoor(t.bot, GATE), true, 'the cow reaches z 4.45, into the bar');
        s.service.stop();
        t.service.stop();
    });

    test('a gate facing east: its bar runs along z; a gate without a facing keeps the whole cell', () => {
        const s = scene();
        mob(s, 'chicken', [612.9, 61, 4.5], 0.4);
        assert.equal(D.somebodyInDoor(s.bot, { ...GATE, facing: 'east' }), false, 'beside the bar (x 612.7..613.1)');
        assert.equal(D.somebodyInDoor(s.bot, GATE), true, 'facing south: in the bar (x 612..613, z 4.375..4.625)');
        assert.equal(D.somebodyInDoor(s.bot, { x: 612, y: 61, z: 4, kind: 'gate' }), true, 'no facing: the cell');
        s.service.stop();
    });

    test('the cow against the bar inside the pen: the bot walks out and the gate is closed', async () => {
        const s = scene();
        mob(s, 'cow', [612.984, 61, 5.075], 0.9);
        await walkOut(s);
        for (let i = 0; i < 10 && s.isOpen(); i++) await s.step();
        assert.equal(s.isOpen(), false);
        s.service.stop();
    });
});
