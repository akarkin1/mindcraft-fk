// v0.1.4.14, fix round (engineer E4): W116 unsaved_pen on 26.1, check 2 "the gate is closed within 10 s after the bot
// passed". With "open the pen" the follow's approach opened the gate of the pen (openTowardPlayer of skills.js) and
// reserved it with the door service for 20 s; the follow never handed it back. The bot stood 1.1 blocks inside the gate
// (within the 1.5 blocks that hold a reservation on), the service's own log said "reserved" on every look, and the
// gate stood open; in the runs that passed, the item reflex had walked the bot more than 1.5 blocks away. toward_doors.js
// hands a reservation back once the bot is on the other side (passed), and all of them when the walk ends. On the fake
// bot of the home pack with the real door service.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeFakeBot, v } from './home_fake_bot.test.js';

const D = await loadSrc('src/agent/packs/home/doors.js');
const T = await loadSrc('src/agent/library/toward_doors.js');

// the pen x 608..616, z 4..12, its gate in the north fence, open (the approach opened it); the bot north of it, outside
const GATE = Object.freeze({ x: 612, y: 61, z: 4, kind: 'gate', name: 'oak_fence_gate', facing: 'south' });

function scene() {
    const world = makeWorld();
    world.set(612, 61, 4, 'oak_fence_gate', { facing: 'south', open: true });
    const bot = makeFakeBot({ world, pos: [612.5, 61, 2.6] });
    bot.areaGuard = { areaAt: p => (p.x >= 608 && p.x <= 617 && p.z >= 4 && p.z <= 13 ? { name: 'pen', type: 'pen' } : null) };
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
    // what openTowardPlayer does: reserve for 20 s, note the side of the bot (north of the gate: -1)
    D.reserveDoor(bot, GATE, 20000);
    T.noteTowardReserved(bot, GATE, -1);
    return { bot, step, service, isOpen: () => world.propsAt(612, 61, 4).open === true };
}

// the follow of W116: through the gate, then standing 1.1 blocks inside it
async function walkIn(s) {
    await s.step();
    await s.step([612.5, 61, 3.6]);
    await s.step([612.5, 61, 4.5]);
    await s.step([612.5, 61, 5.6]);
}

describe('W116 on 26.1: the reservation of the gate the follow opened', () => {
    test('the control: kept, the reservation holds the gate open while the bot stands 1.1 inside it', async () => {
        const s = scene();
        await walkIn(s);
        for (let i = 0; i < 20; i++) await s.step();
        assert.equal(s.isOpen(), true, 'reserved: the failure of W116');
        s.service.stop();
    });

    test('handed back once the bot is through: the gate is closed', async () => {
        const s = scene();
        await walkIn(s);
        assert.equal(T.releasePassedToward(s.bot), 1);
        for (let i = 0; i < 10 && s.isOpen(); i++) await s.step();
        assert.equal(s.isOpen(), false);
        s.service.stop();
    });

    test('not before the bot is through: on its own side, or in the gate, nothing is handed back', async () => {
        const s = scene();
        await s.step([612.5, 61, 3.4]);
        assert.equal(T.releasePassedToward(s.bot), 0, 'still north of the gate');
        await s.step([612.5, 61, 4.5]);
        assert.equal(T.releasePassedToward(s.bot), 0, 'in the gate');
        for (let i = 0; i < 6; i++) await s.step();
        assert.equal(s.isOpen(), true, 'the reservation holds the gate open for the bot');
        s.service.stop();
    });

    test('at the end of the walk every one is handed back, once', async () => {
        const s = scene();
        assert.equal(T.releasePassedToward(s.bot, true), 1);
        assert.equal(T.releasePassedToward(s.bot, true), 0);
        assert.equal(T.releasePassedToward({}), 0, 'a bot with none');
        s.service.stop();
    });
});
