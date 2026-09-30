// v0.1.4.8, fix round (DEFECTS_WORLD_0148.md):
//   X6: the shelter reflex does not find the door when home is only a place. "I could not get to the place
//       "home"." after 5 s at a wall: the path search saw no way in and led the bot to the wall. The walk to
//       the place home looks for doors and gates within 12 blocks of the place and goes through the nearest
//       one with passThrough, towards the place, when the direct walk fails or ends at a wall.
//   X13: the texts of passThrough name what it is: door, gate or trapdoor ("I found no way to the door" was
//       said about a gate).
// The house of home_fake_bot: walls x, z 1..7, the door in the south wall at (4, 64, 7). The fake path search
// of these tests cannot get into the house through a closed door (like the real one in the failing runs):
// a walk from outside to a goal inside ends at the wall; through an open door it gets in.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeFakeBot, buildHouse, straightGoto, v } from './home_fake_bot.test.js';

const S = await loadSrc('src/agent/packs/home/shelter.js');
const D = await loadSrc('src/agent/packs/home/doors.js');

const FAST = { checkMs: 40 };
const inside = (p) => p.x >= 2 && p.x < 7 && p.z >= 2 && p.z < 7;
const HOME = { x: 4, y: 64, z: 4 };

function placeScene({ botAt = [10.5, 64, 4.5], door = true } = {}) {
    const world = makeWorld();
    buildHouse(world, { withDoor: door });
    const bot = makeFakeBot({ world, pos: botAt });
    // the path search of the tests: in or out of the house only through the open door
    bot.gotoImpl = async (goal) => {
        const target = Number.isFinite(goal?.x) ? v(goal.x + 0.5, goal.y ?? 64, goal.z + 0.5) : null;
        if (!target) return;
        const from = bot.entity.position;
        if (inside(from) !== inside(target) && world.propsAt(4, 64, 7).open !== true) {
            // no way in: the path search walks to the point nearest to the goal, at the east wall, and ends
            if (from.x > 7) bot.entity.position = v(7.8, 64, Math.min(Math.max(target.z, 1.5), 6.5));
            return;
        }
        return straightGoto(bot, goal);
    };
    const logs = [];
    const ctx = {
        areas: [], // no area: home is only a place
        places: { recall: (name) => (name === 'home' ? { ...HOME, dimension: 'overworld' } : null) },
        settings: {}, log: (t) => logs.push(t), now: () => Date.now(),
    };
    return { world, bot, ctx, logs };
}

describe('X6: the walk to the place "home" goes through the door of its building', () => {
    test('the direct walk ends at the east wall: the bot goes round through the door, closes it and reaches the place', async () => {
        const { world, bot, ctx } = placeScene();
        const res = await S.goToShelter(bot, ctx, FAST);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(res.where, 'home');
        assert.equal(res.text, 'I went through the door at (4, 64, 7) and closed it. I am at the place "home". I know no building around it.');
        const p = bot.entity.position;
        assert.ok(Math.hypot(p.x - 4.5, p.z - 4.5) <= 2, `at the place: ${p}`);
        assert.equal(world.propsAt(4, 64, 7).open, false, 'the door is closed');
    });

    test('a door whose inner side the bot is on (behind the east wall): passThrough goes to the outer side first (option toward)', async () => {
        const { bot, ctx } = placeScene({ botAt: [10.5, 64, 4.5] });
        // the bot at z 4.5 stands on the inner side of the plane of the south door, but outside the walls
        const res = await S.goToShelter(bot, ctx, FAST);
        assert.equal(res.ok, true);
        const goals = bot.calls.filter((c) => c[0] === 'goto').map((c) => c[1]).filter((g) => Number.isFinite(g?.x));
        assert.ok(goals.some((g) => g.x === 4 && g.z === 8), 'walked to the outer side of the door (4, 64, 8)');
    });

    test('the direct walk works: no door is used, the text of v0.1.4.8', async () => {
        const { bot, ctx } = placeScene({ botAt: [4.5, 64, 3.5] });
        const res = await S.goToShelter(bot, ctx, FAST);
        assert.deepEqual({ ok: res.ok, text: res.text }, { ok: true, text: 'I am at the place "home". I know no building around it.' });
        assert.equal(bot.calls.filter((c) => c[0] === 'activate').length, 0);
    });

    test('no door within 12 blocks of the place: the old answer, "I could not get to the place "home"."', async () => {
        const { bot, ctx } = placeScene({ door: false });
        bot.gotoImpl = async () => {}; // the path search never gets nearer
        const res = await S.goToShelter(bot, ctx, FAST);
        assert.equal(res.ok, false);
        assert.equal(res.text, 'I could not get to the place "home".');
    });

    test('stopped: no door is tried', async () => {
        const { bot, ctx } = placeScene();
        bot.interrupt_code = true;
        const res = await S.goToShelter(bot, ctx, FAST);
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'interrupted');
        assert.equal(bot.calls.filter((c) => c[0] === 'activate').length, 0);
    });

    test('findOpenables measures from a given point (the place), not from the bot', () => {
        const { bot } = placeScene({ botAt: [40.5, 64, 40.5] });
        assert.deepEqual(D.findOpenables(bot, 6), []);
        const near = D.findOpenables(bot, 12, { x: 4.5, y: 64, z: 4.5 });
        assert.deepEqual(near.map((d) => [d.x, d.y, d.z, d.kind]), [[4, 64, 7, 'door']]);
    });

    test('the range is 12 blocks', () => {
        assert.equal(S.PLACE_DOOR_RANGE, 12);
    });
});

describe('X13: the texts of passThrough name door, gate or trapdoor', () => {
    function gateScene() {
        const world = makeWorld();
        world.gate(4, 64, 7, { facing: 'south' });
        const bot = makeFakeBot({ world, pos: [4.5, 64, 12.5] });
        return { world, bot, ctx: { areas: [], settings: {}, log: () => {}, now: () => Date.now() }, gate: { x: 4, y: 64, z: 7 } };
    }

    test('no way to a gate: "I found no way to the gate at (x, y, z)."', async () => {
        const { bot, ctx, gate } = gateScene();
        bot.gotoImpl = async () => { const e = new Error('No path'); e.name = 'NoPath'; throw e; };
        const res = await D.passThrough(bot, gate, ctx, FAST);
        assert.equal(res.reason, 'no_path');
        assert.equal(res.text, 'I found no way to the gate at (4, 64, 7).');
    });

    test('through a gate: "I went through the gate at (x, y, z) and closed it."', async () => {
        const { world, bot, ctx, gate } = gateScene();
        const res = await D.passThrough(bot, gate, ctx, FAST);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(res.text, 'I went through the gate at (4, 64, 7) and closed it.');
        assert.equal(world.propsAt(4, 64, 7).open, false);
    });

    test('a gate that does not open: "The gate at (x, y, z) does not open."', async () => {
        const { bot, ctx, gate } = gateScene();
        bot.failActivations = 99;
        assert.equal((await D.passThrough(bot, gate, ctx, FAST)).text, 'The gate at (4, 64, 7) does not open.');
    });

    test('a door keeps its texts: "I found no way to the door at (x, y, z)."', async () => {
        const world = makeWorld();
        buildHouse(world);
        const bot = makeFakeBot({ world, pos: [4.5, 64, 12.5] });
        bot.gotoImpl = async () => { const e = new Error('No path'); e.name = 'NoPath'; throw e; };
        const res = await D.passThrough(bot, { x: 4, y: 64, z: 7 }, { areas: [] }, FAST);
        assert.equal(res.text, 'I found no way to the door at (4, 64, 7).');
    });
});
