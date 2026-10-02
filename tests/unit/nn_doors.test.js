// Spec v0.1.4.11, part N (engineer E4), I8 and N1: the reservation of an openable that a walk is about to pass
// (DoorWatch.reserve of door_logic.js, reserve and release of the door service, reserveDoor of doors.js), and canOpen
// of the dry scan (iron, locked, blocked).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeMiningBot } from './mining_fake_bot.test.js';

const L = await loadSrc('src/agent/packs/home/door_logic.js');
const H = await loadSrc('src/agent/packs/home/doors.js');

// an open door of a saved area: the service closes it at the start once the bot is more than 0.8 blocks from it
const DOOR = { x: 0, y: 64, z: 0, kind: 'door', open: true, name: 'oak_door', facing: 'east', inArea: true };
const look = (watch, now, x) => watch.observe({ now, botPos: { x, y: 64, z: 0.5 }, moving: false, doors: [{ ...DOOR }], players: [] });

describe('DoorWatch.reserve (I8)', () => {
    test('without a reservation the open door is returned to close (the rule of before)', () => {
        const watch = new L.DoorWatch();
        assert.equal(look(watch, 0, 3.5).length, 1);
    });

    test('reserved: not closed before the end of the reservation, closed after it', () => {
        const watch = new L.DoorWatch();
        assert.equal(watch.reserve(DOOR, 0, 5000), true);
        assert.deepEqual(look(watch, 0, 3.5), []);
        assert.deepEqual(look(watch, 4900, 3.5), []);
        assert.equal(look(watch, 5100, 3.5).length, 1);
        assert.equal(watch.reservedCount, 0, 'a reservation that ran out with the bot away is dropped');
    });

    test('at most 20 s', () => {
        const watch = new L.DoorWatch();
        watch.reserve(DOOR, 0, 60000);
        assert.deepEqual(look(watch, 19000, 3.5), []);
        assert.equal(look(watch, 20100, 3.5).length, 1);
        assert.equal(L.DOOR_SERVICE_RULES.reserveMaxMs, 20000);
    });

    test('after its end, never while the bot is within 1.5 blocks; released, the rule of before', () => {
        const watch = new L.DoorWatch();
        watch.reserve(DOOR, 0, 1000);
        assert.deepEqual(look(watch, 3000, 1.6), [], 'the bot 1.1 blocks from the door');
        assert.equal(watch.isReserved(DOOR, 3000, { x: 1.6, y: 64, z: 0.5 }), true);
        watch.release(DOOR);
        assert.equal(look(watch, 3100, 1.6).length, 1);
    });

    test('the upper half of a door counts for the door; release without a door ends every reservation', () => {
        const watch = new L.DoorWatch();
        watch.reserve({ x: 0, y: 65, z: 0 }, 0, 5000);
        assert.equal(watch.isReserved(DOOR, 100, null), true);
        watch.reserve({ x: 7, y: 64, z: 7 }, 0, 5000);
        watch.release();
        assert.equal(watch.reservedCount, 0);
        assert.equal(watch.reserve(null, 0, 5000), false);
    });

    test('reset forgets the reservations', () => {
        const watch = new L.DoorWatch();
        watch.reserve(DOOR, 0, 5000);
        watch.reset();
        assert.equal(watch.reservedCount, 0);
    });
});

describe('the door service: reserve, release, reserveDoor (I8)', () => {
    test('the service reserves with its clock and is reached through reserveDoor while it runs', () => {
        const bot = makeMiningBot();
        const service = H.createDoorService(bot, { settings: {}, now: () => 1000 });
        assert.equal(typeof service.reserve, 'function');
        assert.equal(typeof service.release, 'function');
        assert.equal(service.reserve(DOOR, 5000), true);
        assert.equal(H.reserveDoor(bot, DOOR, 5000), true);
        H.releaseDoor(bot, DOOR);
        service.stop();
        assert.equal(service.reserve(DOOR, 5000), false, 'a stopped service reserves nothing');
        assert.equal(H.reserveDoor(bot, DOOR, 5000), false, 'no running service');
    });

    test('reserveDoor without a service, or without a bot: false, never a throw', () => {
        assert.equal(H.reserveDoor(makeMiningBot(), DOOR, 5000), false);
        assert.equal(H.reserveDoor(null, DOOR, 5000), false);
        H.releaseDoor(null, DOOR);
    });
});

describe('canOpen (N1)', () => {
    function doorWorld() {
        const world = makeWorld();
        world.set(9, 64, 43, 'oak_door', { facing: 'south', half: 'lower', open: false, powered: false });
        world.set(9, 65, 43, 'oak_door', { facing: 'south', half: 'upper', open: false, powered: false });
        return { world, bot: makeMiningBot({ world, pos: [9.5, 64, 40.5] }) };
    }

    test('a closed wooden door with free cells before and behind it: yes', () => {
        const { bot } = doorWorld();
        assert.equal(H.canOpen(bot, { x: 9, y: 64, z: 43 }), true);
        assert.equal(H.canOpen(bot, { x: 9, y: 65, z: 43 }), true, 'the upper half is read as the door');
    });

    test('a block before or behind it (feet or head): no', () => {
        for (const cell of [[9, 64, 44], [9, 64, 42], [9, 65, 44]]) {
            const { world, bot } = doorWorld();
            world.set(...cell, 'stone');
            assert.equal(H.canOpen(bot, { x: 9, y: 64, z: 43 }), false, cell.join(','));
        }
    });

    test('a torch beside it does not block it', () => {
        const { world, bot } = doorWorld();
        world.set(9, 64, 44, 'torch');
        assert.equal(H.canOpen(bot, { x: 9, y: 64, z: 43 }), true);
    });

    test('locked (closed and powered), iron, nothing there: no', () => {
        const { world, bot } = doorWorld();
        world.set(9, 64, 43, 'oak_door', { facing: 'south', half: 'lower', open: false, powered: true });
        assert.equal(H.canOpen(bot, { x: 9, y: 64, z: 43 }), false);
        world.set(9, 64, 43, 'iron_door', { facing: 'south', half: 'lower', open: false });
        assert.equal(H.canOpen(bot, { x: 9, y: 64, z: 43 }), false);
        assert.equal(H.canOpen(bot, { x: 0, y: 64, z: 0 }), false);
        assert.equal(H.canOpen(bot, null), false);
    });

    test('a trapdoor: no with a block on it, yes without; a gate', () => {
        const world = makeWorld({ groundY: 60 });
        world.set(2, 60, -2, 'oak_trapdoor', { facing: 'south', half: 'top', open: false });
        world.set(5, 61, 5, 'oak_fence_gate', { facing: 'north', open: false });
        const bot = makeMiningBot({ world, pos: [0.5, 61, 0.5] });
        assert.equal(H.canOpen(bot, { x: 2, y: 60, z: -2 }), true);
        assert.equal(H.canOpen(bot, { x: 5, y: 61, z: 5 }), true);
        world.set(2, 61, -2, 'stone');
        assert.equal(H.canOpen(bot, { x: 2, y: 60, z: -2 }), false);
        world.set(5, 61, 6, 'stone');
        assert.equal(H.canOpen(bot, { x: 5, y: 61, z: 5 }), false);
    });
});
