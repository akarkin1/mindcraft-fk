// Spec v0.1.4.8, part C (C5, I8): the door service. DoorWatch of door_logic.js decides, pure;
// createDoorService and closeNear of doors.js act on a fake bot. tick() is called like the background
// mode door_closing of part A does: often, also while an action moves the bot.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { makeWorld, makeFakeBot, buildHouse, addMob, addPlayer, v } from './home_fake_bot.test.js';

const L = await loadSrc('src/agent/packs/home/door_logic.js');
const D = await loadSrc('src/agent/packs/home/doors.js');

const ON = { home_pack: true };
const settle = () => new Promise(r => setTimeout(r, 5));

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

// ---------------------------------------------------------------- DoorWatch, pure

const DOOR = { x: 4, y: 64, z: 7, kind: 'door', name: 'oak_door', facing: 'south' };
const at = (x, z, y = 64) => ({ x, y, z });

function look(watch, t, botPos, door, over = {}) {
    return watch.observe({ now: t, botPos, moving: over.moving ?? true, players: over.players ?? [], doors: door ? [{ ...door, ...over.door }] : [] });
}

describe('C5: DoorWatch, what is noted', () => {
    test('closed to open within 3 blocks while the bot moves: noted; the bot passes it and is 2 blocks away: close', () => {
        const w = new L.DoorWatch();
        look(w, 0, at(4.5, 10), { ...DOOR, open: false });
        look(w, 300, at(4.5, 9), { ...DOOR, open: true });
        assert.equal(w.noted(DOOR)?.why, 'opened');
        assert.deepEqual(look(w, 600, at(4.5, 7.5), { ...DOOR, open: true }), [], 'in the doorway');
        assert.deepEqual(look(w, 900, at(4.5, 5.6), { ...DOOR, open: true }), [], '1.9 blocks past');
        const out = look(w, 1200, at(4.5, 5.5), { ...DOOR, open: true });
        assert.equal(out.length, 1);
        assert.deepEqual({ x: out[0].x, y: out[0].y, z: out[0].z, why: out[0].why }, { x: 4, y: 64, z: 7, why: 'opened' });
    });

    test('opened farther than 3 blocks: not noted', () => {
        const w = new L.DoorWatch();
        look(w, 0, at(4.5, 12), { ...DOOR, open: false });
        look(w, 300, at(4.5, 11), { ...DOOR, open: true });
        assert.equal(w.noted(DOOR), null);
    });

    test('the bot stands still: noted when no player is within 3 blocks (the bot opened it), not when one is', () => {
        const own = new L.DoorWatch();
        look(own, 0, at(4.5, 9), { ...DOOR, open: false }, { moving: false });
        look(own, 300, at(4.5, 9), { ...DOOR, open: true }, { moving: false });
        assert.equal(own.noted(DOOR)?.why, 'opened');
        const player = new L.DoorWatch();
        const players = [at(4.5, 6)];
        look(player, 0, at(4.5, 9), { ...DOOR, open: false }, { moving: false, players });
        look(player, 300, at(4.5, 9), { ...DOOR, open: true }, { moving: false, players });
        assert.equal(player.noted(DOOR), null);
    });

    test('an open door seen for the first time is no transition (outside of the start)', () => {
        const w = new L.DoorWatch();
        look(w, 0, at(4.5, 20), null);
        look(w, 6000, at(4.5, 9), { ...DOOR, open: true });
        assert.equal(w.noted(DOOR), null);
    });

    // v0.1.4.9, decision F21 (E1): this test read "opened and not passed: closed when the bot is 4 blocks away";
    // the service now closes only what the bot passed
    test('opened and not passed: never closed (F21)', () => {
        const w = new L.DoorWatch();
        look(w, 0, at(4.5, 10), { ...DOOR, open: false });
        look(w, 300, at(4.5, 10), { ...DOOR, open: true });
        assert.deepEqual(look(w, 600, at(4.5, 11.4), { ...DOOR, open: true }), []);
        assert.deepEqual(look(w, 900, at(4.5, 11.5), { ...DOOR, open: true }), []);
        assert.deepEqual(look(w, 1200, at(4.5, 14), { ...DOOR, open: true }), []);
    });

    test('iron doors are never noted', () => {
        const w = new L.DoorWatch();
        const iron = { ...DOOR, name: 'iron_door' };
        look(w, 0, at(4.5, 9), { ...iron, open: false });
        look(w, 300, at(4.5, 9), { ...iron, open: true });
        assert.equal(w.size, 0);
    });
});

describe('C5: DoorWatch, when it is not closed', () => {
    function passed() {
        const w = new L.DoorWatch();
        look(w, 0, at(4.5, 10), { ...DOOR, open: false });
        look(w, 300, at(4.5, 8), { ...DOOR, open: true });
        return w;
    }

    test('somebody stands in it', () => {
        const w = passed();
        assert.deepEqual(look(w, 600, at(4.5, 5), { ...DOOR, open: true }, { door: { occupied: true } }), []);
        assert.equal(look(w, 900, at(4.5, 5), { ...DOOR, open: true }).length, 1, 'after it left');
    });

    test('another player within 2 blocks of it', () => {
        const w = passed();
        assert.deepEqual(look(w, 600, at(4.5, 5), { ...DOOR, open: true }, { players: [at(4.5, 9)] }), []);
    });

    test('out of reach (more than 5 blocks)', () => {
        const w = passed();
        assert.deepEqual(look(w, 600, at(4.5, 2.4), { ...DOOR, open: true }), []);
    });

    test('closed by somebody else: forgotten', () => {
        const w = passed();
        look(w, 600, at(4.5, 6), { ...DOOR, open: false });
        assert.equal(w.size, 0);
        assert.deepEqual(w.takeClosedLate(), [], 'not closed by the service');
    });

    test('forgotten after 60 s or 16 blocks away', () => {
        const w = passed();
        look(w, 60_400, at(4.5, 7.5), { ...DOOR, open: true });
        assert.equal(w.size, 0);
        const far = passed();
        look(far, 600, at(4.5, 30), null);
        assert.equal(far.size, 0);
    });
});

describe('C5: DoorWatch, attempts', () => {
    test('up to 3 attempts, 1 s apart; then it gives up', () => {
        const w = new L.DoorWatch();
        look(w, 0, at(4.5, 10), { ...DOOR, open: false });
        look(w, 300, at(4.5, 8), { ...DOOR, open: true });
        const door = look(w, 600, at(4.5, 5), { ...DOOR, open: true })[0];
        assert.equal(w.attempt(door, false, 600), 'retry');
        assert.deepEqual(look(w, 1000, at(4.5, 5), { ...DOOR, open: true }), [], 'not within 1 s');
        assert.equal(look(w, 1600, at(4.5, 5), { ...DOOR, open: true }).length, 1);
        assert.equal(w.attempt(door, false, 1600), 'retry');
        assert.equal(w.attempt(door, false, 2600), 'gave_up');
        assert.equal(w.size, 0);
        assert.equal(w.attempt(door, false, 2700), 'unknown');
    });

    test('a closed attempt forgets it; a late block update is reported once', () => {
        const w = new L.DoorWatch();
        look(w, 0, at(4.5, 10), { ...DOOR, open: false });
        look(w, 300, at(4.5, 8), { ...DOOR, open: true });
        const door = look(w, 600, at(4.5, 5), { ...DOOR, open: true })[0];
        assert.equal(w.attempt(door, false, 600), 'retry');
        look(w, 900, at(4.5, 5), { ...DOOR, open: false });
        assert.deepEqual(w.takeClosedLate().map(d => d.name), ['oak_door']);
        assert.deepEqual(w.takeClosedLate(), []);
        const ok = new L.DoorWatch();
        look(ok, 0, at(4.5, 10), { ...DOOR, open: false });
        look(ok, 300, at(4.5, 8), { ...DOOR, open: true });
        assert.equal(ok.attempt(DOOR, true, 600), 'closed');
        assert.equal(ok.size, 0);
    });
});

describe('C5: DoorWatch, gates of pens and farms', () => {
    const GATE = { x: 20, y: 64, z: 10, kind: 'gate', name: 'oak_fence_gate', facing: 'south', gated: true };

    test('an open gate of a pen that the bot passes is closed, also when it was open before', () => {
        const w = new L.DoorWatch();
        look(w, 6000, at(20.5, 14), { ...GATE, open: true });
        assert.equal(w.noted(GATE), null, 'not passed yet');
        look(w, 6300, at(20.5, 10.6), { ...GATE, open: true });
        assert.equal(w.noted(GATE)?.why, 'gate');
        assert.equal(look(w, 6600, at(20.5, 8.5), { ...GATE, open: true }).length, 1);
    });

    test('an open gate of no pen or farm that the bot walks through without opening: left alone', () => {
        const w = new L.DoorWatch();
        look(w, 6000, at(20.5, 14), { ...GATE, gated: false, open: true });
        look(w, 6300, at(20.5, 10.6), { ...GATE, gated: false, open: true });
        assert.deepEqual(look(w, 6600, at(20.5, 8.5), { ...GATE, gated: false, open: true }), []);
    });
});

describe('C5: DoorWatch, the start', () => {
    test('during the first 5 s: an open door of a saved area with no player within 3 blocks is closed at once', () => {
        const w = new L.DoorWatch();
        const out = look(w, 0, at(4.5, 10), { ...DOOR, open: true, inArea: true });
        assert.equal(out.length, 1);
        assert.equal(out[0].why, 'start');
    });

    test('not with a player within 3 blocks of it, not outside of a saved area, not after 5 s, not with the bot in it', () => {
        const player = new L.DoorWatch();
        assert.deepEqual(look(player, 0, at(4.5, 10), { ...DOOR, open: true, inArea: true }, { players: [at(4.5, 9.5)] }), []);
        const outside = new L.DoorWatch();
        assert.deepEqual(look(outside, 0, at(4.5, 10), { ...DOOR, open: true, inArea: false }), []);
        const late = new L.DoorWatch();
        look(late, 0, at(4.5, 30), null);
        assert.deepEqual(look(late, 5100, at(4.5, 10), { ...DOOR, open: true, inArea: true }), []);
        const inside = new L.DoorWatch();
        assert.deepEqual(look(inside, 0, at(4.5, 7.5), { ...DOOR, open: true, inArea: true }), []);
    });
});

describe('C5: DoorWatch, trapdoors', () => {
    const HATCH = { x: 0, y: 64, z: 0, kind: 'trapdoor', name: 'oak_trapdoor', facing: 'north' };

    test('the bot climbs down through a hatch it opened: closed when it is 2 blocks below', () => {
        const w = new L.DoorWatch();
        look(w, 0, at(1.5, 0.5, 64), { ...HATCH, open: false });
        look(w, 300, at(1.5, 0.5, 64), { ...HATCH, open: true });
        assert.deepEqual(look(w, 600, at(0.5, 0.5, 63), { ...HATCH, open: true }), []);
        assert.equal(look(w, 900, at(0.5, 0.5, 62), { ...HATCH, open: true }).length, 1);
    });
});

// ---------------------------------------------------------------- the service on a fake bot

function scene({ settings = ON, doorOpen = false, botAt = [4.5, 64, 10.5], house = true } = {}) {
    const world = makeWorld();
    const area = house ? buildHouse(world, { doorOpen }) : null;
    const bot = makeFakeBot({ world, pos: botAt });
    let t = 1_000_000;
    const clock = { now: () => t, wait: async (ms) => { t += Math.max(ms, 1); await Promise.resolve(); } };
    const ctx = { areas: area ? [area] : [], settings, now: clock.now, log: () => {} };
    const service = D.createDoorService(bot, ctx, { now: clock.now, wait: clock.wait, checkMs: 40 });
    const step = async (pos) => {
        if (pos) bot.entity.position = v(...pos);
        t += 300;
        service.tick();
        await settle();
    };
    const advance = (ms) => { t += ms; };
    return { world, area, bot, ctx, service, step, advance, clock, isOpen: (x, y, z) => world.propsAt(x, y, z).open === true };
}

describe('C5: createDoorService', () => {
    test('the path finder opens the door, the bot walks through: closed 2 blocks behind it, one line in the console', async () => {
        const s = scene();
        await s.step([4.5, 64, 10.5]);
        s.world.toggle(4, 64, 7); // the path finder opens it
        await s.step([4.5, 64, 8.5]);
        await s.step([4.5, 64, 7.5]);
        assert.equal(s.isOpen(4, 64, 7), true, 'open while the bot is in the doorway');
        await s.step([4.5, 64, 5.5]);
        assert.equal(s.isOpen(4, 64, 7), false);
        assert.ok(cap.allText().includes('Door service: closed oak_door at (4, 64, 7).'), cap.allText());
        assert.equal(s.bot.calls.some(c => c[0] === 'setGoal' || c[0] === 'goto' || c[0] === 'clearControls'), false, 'the path search is not touched');
    });

    test('tick is quick: it returns at once and waits for no closing', async () => {
        const s = scene();
        s.bot.activateDelayMs = 30;
        await s.step([4.5, 64, 10.5]);
        s.world.toggle(4, 64, 7);
        await s.step([4.5, 64, 8.5]);
        await s.step([4.5, 64, 7.5]);
        s.bot.entity.position = v(4.5, 64, 5.5);
        s.advance(300);
        const start = Date.now();
        const ret = s.service.tick();
        assert.equal(ret, undefined, 'no promise');
        assert.ok(Date.now() - start < 20);
        assert.equal(s.bot.calls.filter(c => c[0] === 'activate').length, 1, 'the click is sent');
        await new Promise(r => setTimeout(r, 60));
    });

    test('somebody stands in the door: it stays open; when the cow leaves it is closed', async () => {
        const s = scene();
        await s.step([4.5, 64, 10.5]);
        s.world.toggle(4, 64, 7);
        await s.step([4.5, 64, 8.5]);
        await s.step([4.5, 64, 7.5]);
        const cow = addMob(s.bot, 'cow', [4.5, 64, 7.4], { type: 'animal' });
        await s.step([4.5, 64, 5.5]);
        assert.equal(s.isOpen(4, 64, 7), true);
        delete s.bot.entities[cow.id];
        await s.step();
        assert.equal(s.isOpen(4, 64, 7), false);
    });

    test('F37: the bot climbs a ladder 2 blocks past the door: no click while it hangs on the ladder, closed once it is off', async () => {
        const s = scene();
        s.world.set(4, 64, 5, 'ladder', { facing: 'south' });
        s.world.set(4, 65, 5, 'ladder', { facing: 'south' });
        await s.step([4.5, 64, 10.5]);
        s.world.toggle(4, 64, 7);
        await s.step([4.5, 64, 8.5]);
        await s.step([4.5, 64, 7.5]);
        s.bot.entity.onGround = false;
        await s.step([4.5, 64.6, 5.5]); // the feet in the ladder cell
        await s.step([4.5, 65.2, 5.5]);
        assert.equal(s.isOpen(4, 64, 7), true, 'no click while the bot is on the ladder');
        assert.equal(s.bot.calls.filter(c => c[0] === 'activate').length, 0);
        s.bot.entity.onGround = true;
        await s.step([4.5, 66, 4.5]); // off the ladder, on the floor above
        assert.equal(s.isOpen(4, 64, 7), false, 'closed once the bot is off the ladder');
    });

    test('an item lying in the doorway does not keep it open', async () => {
        const s = scene();
        await s.step([4.5, 64, 10.5]);
        s.world.toggle(4, 64, 7);
        await s.step([4.5, 64, 8.5]);
        await s.step([4.5, 64, 7.5]);
        addMob(s.bot, 'item', [4.5, 64, 7.5], { type: 'other' });
        await s.step([4.5, 64, 5.5]);
        assert.equal(s.isOpen(4, 64, 7), false);
    });

    test('a player opens the door while the bot stands still 2 blocks away: it stays open', async () => {
        const s = scene({ house: false });
        s.world.door(4, 64, 7);
        addPlayer(s.bot, 'steve', [4.5, 64, 6.5]);
        await s.step([4.5, 64, 9.5]);
        s.world.toggle(4, 64, 7);
        for (let i = 0; i < 5; i++) await s.step();
        assert.equal(s.isOpen(4, 64, 7), true);
    });

    test('the open gate of a pen that the bot walks through is closed, although it was open before', async () => {
        const s = scene({ house: false });
        s.world.gate(20, 64, 10, { facing: 'south', open: true });
        s.ctx.areas = [{ name: 'pen', type: 'pen', min: { x: 16, y: 63, z: 3 }, max: { x: 24, y: 66, z: 10 } }];
        await s.step([20.5, 64, 30.5]); // the start is over before the bot comes near
        s.bot.entity.position = v(20.5, 64, 30.5);
        for (let i = 0; i < 20; i++) await s.step();
        await s.step([20.5, 64, 14.5]);
        assert.equal(s.isOpen(20, 64, 10), true, 'not passed yet');
        await s.step([20.5, 64, 10.5]);
        await s.step([20.5, 64, 8.5]);
        assert.equal(s.isOpen(20, 64, 10), false);
        assert.ok(cap.allText().includes('Door service: closed oak_fence_gate at (20, 64, 10).'));
    });

    test('the start: an open door of a saved area within 6 blocks is closed, not with a player within 3 of it', async () => {
        const s = scene({ doorOpen: true, botAt: [4.5, 64, 11.5] });
        await s.step();
        assert.equal(s.isOpen(4, 64, 7), false);
        const p = scene({ doorOpen: true, botAt: [4.5, 64, 11.5] });
        addPlayer(p.bot, 'steve', [4.5, 64, 9.5]);
        for (let i = 0; i < 3; i++) await p.step();
        assert.equal(p.isOpen(4, 64, 7), true);
        const free = scene({ house: false, botAt: [4.5, 64, 11.5] });
        free.world.door(4, 64, 7, { open: true });
        await free.step();
        assert.equal(free.isOpen(4, 64, 7), true, 'a door of no saved area');
    });

    test('a door that does not close: 3 attempts, then a line in the console', async () => {
        const s = scene();
        await s.step([4.5, 64, 10.5]);
        s.world.toggle(4, 64, 7);
        await s.step([4.5, 64, 8.5]);
        await s.step([4.5, 64, 7.5]);
        s.bot.failActivations = 99;
        s.bot.entity.position = v(4.5, 64, 5.5);
        for (let i = 0; i < 12; i++) await s.step();
        assert.equal(s.bot.calls.filter(c => c[0] === 'activate').length, 3);
        assert.ok(cap.allText().includes('Door service: could not close oak_door at (4, 64, 7).'));
    });

    test('home_pack off or the reflex door_closing off: tick does nothing; after stop() neither', async () => {
        for (const settings of [{}, { home_pack: true, home_reflexes: { door_closing: false } }]) {
            const s = scene({ settings, doorOpen: true });
            let looked = 0;
            const inner = s.bot.findBlocks;
            s.bot.findBlocks = (o) => { looked++; return inner(o); };
            for (let i = 0; i < 3; i++) await s.step();
            assert.equal(looked, 0);
            assert.equal(s.isOpen(4, 64, 7), true);
        }
        const s = scene({ doorOpen: true });
        s.service.stop();
        await s.step();
        assert.equal(s.isOpen(4, 64, 7), true);
    });

    test('nothing while passThrough runs, the bot eats or sleeps', async () => {
        const s = scene({ doorOpen: true, botAt: [4.5, 64, 11.5] });
        s.bot.usingHeldItem = true;
        await s.step();
        assert.equal(s.isOpen(4, 64, 7), true);
        s.bot.usingHeldItem = false;
        await s.step();
        assert.equal(s.isOpen(4, 64, 7), false);
    });

    test('tick never throws', () => {
        const broken = D.createDoorService(null, { settings: ON });
        assert.doesNotThrow(() => broken.tick());
        const bot = makeFakeBot();
        bot.findBlocks = () => { throw new Error('chunk'); };
        const s = D.createDoorService(bot, { settings: ON, get areas() { throw new Error('x'); } });
        assert.doesNotThrow(() => s.tick());
    });
});

describe('C5: closeNear (!closeDoor)', () => {
    test('closes every open openable within 6 blocks: the text of the spec', async () => {
        const s = scene({ house: false, botAt: [4.5, 64, 4.5] });
        s.world.door(2, 64, 2, { open: true });
        s.world.gate(6, 64, 6, { open: true });
        s.world.set(6, 64, 2, 'oak_trapdoor', { facing: 'north', half: 'bottom', open: false });
        s.world.door(30, 64, 30, { open: true });
        const res = await s.service.closeNear(6);
        assert.equal(res.ok, true);
        assert.equal(res.text, 'I closed oak_door at (2, 64, 2) and oak_fence_gate at (6, 64, 6).');
        assert.equal(s.isOpen(2, 64, 2), false);
        assert.equal(s.isOpen(6, 64, 6), false);
        assert.equal(s.isOpen(30, 64, 30), true, 'farther than 6 blocks');
        assert.ok(cap.allText().includes('Door service: closed oak_door at (2, 64, 2).'));
    });

    test('all closed: the text of the spec', async () => {
        const s = scene({ house: false });
        s.world.door(2, 64, 2);
        assert.deepEqual(await D.closeNear(s.bot, s.ctx, 6), { ok: true, reason: null, closed: [], failed: [], occupied: [], text: 'All doors near me are closed.' });
    });

    test('a door that does not close and a gate somebody stands in: said so', async () => {
        const s = scene({ house: false, botAt: [4.5, 64, 4.5] });
        s.world.door(2, 64, 2, { open: true });
        s.world.gate(6, 64, 6, { open: true });
        addPlayer(s.bot, 'steve', [6.5, 64, 6.5]);
        s.bot.failActivations = 99;
        const res = await D.closeNear(s.bot, s.ctx, 6, { checkMs: 20, now: s.clock.now, wait: s.clock.wait });
        assert.equal(res.ok, false);
        assert.equal(res.text, 'I could not close oak_door at (2, 64, 2). I left oak_fence_gate at (6, 64, 6) open, because somebody stands in it.');
    });

    test('a clock that does not advance cannot keep the check of a door waiting (it hung a run of this file once)', async () => {
        const s = scene({ house: false, botAt: [4.5, 64, 4.5] });
        s.world.door(2, 64, 2, { open: true });
        s.bot.failActivations = 99;
        const frozen = { now: () => 5, wait: () => new Promise(r => setTimeout(r, 1)) };
        const res = await D.closeNear(s.bot, { now: frozen.now }, 6, { checkMs: 50, wait: frozen.wait });
        assert.equal(res.text, 'I could not close oak_door at (2, 64, 2).');
        assert.equal(await D.closeDoor(s.bot, { x: 2, y: 64, z: 2 }, { checkMs: 50, now: frozen.now, wait: frozen.wait }), false);
    });

    test('never throws', async () => {
        const res = await D.closeNear(null, {}, 6);
        assert.equal(typeof res.text, 'string');
    });
});
