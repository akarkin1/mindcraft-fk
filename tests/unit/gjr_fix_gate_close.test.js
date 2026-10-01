// Release v0.1.4.10, fix round, T3-5 (engineer E3): after "come here" the bot left the pen, stopped 1 block past
// its gate (at (611.5, 61, 3.5), the gate at (612, 61, 4)) and the gate stayed open: the door service closed a
// passed openable only 2 blocks past it, and the animals walked out. Decision: a gate the bot passed is closed as
// soon as the feet of the bot are out of the gate cell, at any distance; an entity within 1 block holds the closing
// only when it is not the bot itself; doors (and trapdoors) keep the 2-block rule. DoorWatch of door_logic.js, pure,
// and somebodyNear / somebodyInDoor of doors.js on the fake bot of the home pack.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeFakeBot, addMob, v } from './home_fake_bot.test.js';

const L = await loadSrc('src/agent/packs/home/door_logic.js');
const D = await loadSrc('src/agent/packs/home/doors.js');

// the gate of the pen of W89, in the south fence of the pen; the pen lies at z 5 and more
const GATE = Object.freeze({ x: 612, y: 61, z: 4, kind: 'gate', name: 'oak_fence_gate', facing: 'south' });
const DOOR = Object.freeze({ ...GATE, kind: 'door', name: 'oak_door' });
const at = (x, z, y = 61) => ({ x, y, z });

function look(watch, t, botPos, door, over = {}) {
    return watch.observe({ now: t, botPos, moving: over.moving ?? true, players: over.players ?? [], doors: [{ ...door, ...over.door }] });
}

// the bot in the pen; the path search opens the gate and the bot walks out through it
function walkOut(door, { gated = false } = {}) {
    const w = new L.DoorWatch();
    look(w, 6000, at(612.5, 6.5), { ...door, gated, open: false });
    look(w, 6300, at(612.5, 5.6), { ...door, gated, open: true });
    return w;
}

describe('T3-5: DoorWatch, a gate the bot went through', () => {
    test('W89: the bot stops 1 block past the gate (diagonal, 1.4 from its centre): the gate is closed', () => {
        const w = walkOut(GATE);
        assert.deepEqual(look(w, 6600, at(612.5, 4.5), { ...GATE, open: true }), [], 'in the gate cell');
        const out = look(w, 6900, at(611.5, 3.5), { ...GATE, open: true });
        assert.equal(out.length, 1);
        assert.deepEqual({ x: out[0].x, y: out[0].y, z: out[0].z, why: out[0].why }, { x: 612, y: 61, z: 4, why: 'opened' });
        assert.ok(out[0].distance < L.DOOR_SERVICE_RULES.pastDistance, 'nearer than the 2 blocks of a door');
    });

    test('straight out, 0.9 blocks from the centre of the gate: closed', () => {
        const w = walkOut(GATE);
        look(w, 6600, at(612.5, 4.5), { ...GATE, open: true });
        assert.equal(look(w, 6900, at(612.5, 3.6), { ...GATE, open: true }).length, 1);
    });

    test('the feet past the middle of the gate but still in its cell: not yet', () => {
        const w = walkOut(GATE);
        assert.deepEqual(look(w, 6600, at(612.5, 4.1), { ...GATE, open: true }), []);
        assert.equal(look(w, 6900, at(612.5, 3.9), { ...GATE, open: true }).length, 1, 'out of the cell');
    });

    test('the gate of a pen that was open before: passed and 1 block out, closed', () => {
        const w = new L.DoorWatch();
        look(w, 6000, at(612.5, 6.5), { ...GATE, gated: true, open: true });
        look(w, 6300, at(612.5, 5.2), { ...GATE, gated: true, open: true });
        assert.equal(w.noted(GATE)?.why, 'gate');
        assert.equal(look(w, 6600, at(611.5, 3.5), { ...GATE, gated: true, open: true }).length, 1);
    });

    test('a gate of a pen the bot only came near, without going through: the 2 blocks as before', () => {
        const w = new L.DoorWatch();
        look(w, 6000, at(612.5, 6.5), { ...GATE, gated: true, open: true });
        look(w, 6300, at(612.5, 5.2), { ...GATE, gated: true, open: true });
        assert.deepEqual(look(w, 6600, at(612.5, 6.2), { ...GATE, gated: true, open: true }), [], 'back in the pen, 1.7 away');
        assert.equal(look(w, 6900, at(612.5, 6.6), { ...GATE, gated: true, open: true }).length, 1, '2.1 away');
    });

    test('an entity within 1 block holds the gate open; once it is gone the gate is closed', () => {
        const w = walkOut(GATE);
        look(w, 6600, at(612.5, 4.5), { ...GATE, open: true });
        assert.deepEqual(look(w, 6900, at(611.5, 3.5), { ...GATE, open: true }, { door: { occupied: true } }), []);
        assert.equal(look(w, 7200, at(611.5, 3.5), { ...GATE, open: true }).length, 1);
    });

    test('another player within 2 blocks of the gate still holds it', () => {
        const w = walkOut(GATE);
        look(w, 6600, at(612.5, 4.5), { ...GATE, open: true });
        assert.deepEqual(look(w, 6900, at(611.5, 3.5), { ...GATE, open: true }, { players: [at(613.5, 3.5)] }), []);
    });

    test('a door keeps the 2-block rule: 1.4 blocks past it, not closed; 2 blocks past, closed', () => {
        const w = walkOut(DOOR);
        look(w, 6600, at(612.5, 4.5), { ...DOOR, open: true });
        assert.deepEqual(look(w, 6900, at(611.5, 3.5), { ...DOOR, open: true }), []);
        assert.equal(look(w, 7200, at(612.5, 2.5), { ...DOOR, open: true }).length, 1);
    });

    test('a gate the bot opened but did not pass: never closed (F21 stays)', () => {
        const w = new L.DoorWatch();
        look(w, 6000, at(612.5, 2.5), { ...GATE, open: false });
        look(w, 6300, at(612.5, 2.5), { ...GATE, open: true });
        assert.deepEqual(look(w, 6600, at(611.5, 2.5), { ...GATE, open: true }), []);
        assert.deepEqual(look(w, 6900, at(612.5, 1.0), { ...GATE, open: true }), []);
    });
});

describe('T3-5: the bot itself never holds a gate open', () => {
    function scene(pos) {
        const world = makeWorld({ groundY: 60 });
        world.gate(612, 61, 4, { facing: 'south', open: true });
        const bot = makeFakeBot({ world, pos });
        return { world, bot, gate: { ...GATE } };
    }

    test('the entity of the bot, also as another object with its id, is not somebody near or in the gate', () => {
        const s = scene([611.5, 61, 3.5]);
        assert.equal(D.somebodyNear(s.bot, s.gate), false);
        assert.equal(D.somebodyInDoor(s.bot, s.gate), false);
        // a copy of the bot's entity under its id, as after a respawn
        s.bot.entities[1] = { ...s.bot.entity, position: v(611.5, 61, 3.5) };
        assert.equal(D.somebodyNear(s.bot, s.gate), false);
        s.bot.entities[1] = { id: 77, type: 'player', username: 'Bot', name: 'player', position: v(612.5, 61, 4.5), height: 1.8 };
        assert.equal(D.somebodyInDoor(s.bot, s.gate), false, 'the player entry of the bot by its name');
    });

    test('a chicken within 1 block of the gate is somebody near', () => {
        const s = scene([611.5, 61, 3.5]);
        addMob(s.bot, 'chicken', [613.5, 61, 5.5], { type: 'animal' });
        assert.equal(D.somebodyNear(s.bot, s.gate), true);
    });

    test('another player with the name of no bot is somebody', () => {
        const s = scene([611.5, 61, 3.5]);
        s.bot.entities[50] = { id: 50, type: 'player', username: 'w_player', name: 'player', position: v(612.5, 61, 4.5), height: 1.8 };
        assert.equal(D.somebodyInDoor(s.bot, s.gate), true);
    });
});
