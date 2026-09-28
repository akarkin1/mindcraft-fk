// Spec v0.1.4.6 H2: src/agent/packs/home/doors.js -- finding, opening, closing and passing doors.
// The rule that a door is closed AND CHECKED is the heart of this package.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeFakeBot, buildHouse, addMob, addPlayer } from './home_fake_bot.test.js';

const D = await loadSrc('src/agent/packs/home/doors.js');
const L = await loadSrc('src/agent/packs/home/door_logic.js');

const FAST = { checkMs: 40 };
const activations = bot => bot.calls.filter(c => c[0] === 'activate');
const isOpen = (world, x, y, z) => world.propsAt(x, y, z).open === true;

function houseScene({ botAt = [4.5, 64, 12.5], doorOpen = false } = {}) {
    const world = makeWorld();
    const area = buildHouse(world, { doorOpen });
    const bot = makeFakeBot({ world, pos: botAt });
    const logs = [];
    const ctx = { areas: [area], places: null, settings: {}, log: t => logs.push(t), now: () => Date.now() };
    return { world, area, bot, ctx, logs, door: { x: 4, y: 64, z: 7 } };
}

describe('findOpenables', () => {
    test('doors (lower half only), gates and trapdoors, no iron, no fences', () => {
        const world = makeWorld();
        world.door(2, 64, 0, { facing: 'north', open: true });
        world.gate(4, 64, 0, { facing: 'east' });
        world.set(6, 64, 0, 'oak_trapdoor', { facing: 'north', half: 'bottom', open: false });
        world.door(8, 64, 0, { name: 'iron_door' });
        world.set(0, 64, 3, 'oak_fence');
        world.door(40, 64, 0);
        const bot = makeFakeBot({ world, pos: [4.5, 64, 2.5] });
        const found = D.findOpenables(bot, 6);
        const byKind = Object.fromEntries(found.map(d => [d.kind, d]));
        assert.equal(found.length, 3, JSON.stringify(found));
        assert.deepEqual({ x: byKind.door.x, y: byKind.door.y, z: byKind.door.z, open: byKind.door.open }, { x: 2, y: 64, z: 0, open: true });
        assert.equal(byKind.door.facing, 'north');
        assert.equal(byKind.door.name, 'oak_door');
        assert.equal(byKind.gate.open, false);
        assert.equal(byKind.trapdoor.x, 6);
    });

    test('an upper half in range is reported as its lower half, once', () => {
        const world = makeWorld();
        world.door(0, 64, 0);
        const bot = makeFakeBot({ world, pos: [0.5, 69.5, 0.5] });
        const found = D.findOpenables(bot, 4.6);
        assert.deepEqual(found.map(d => d.y), [64]);
    });

    test('a failing world: empty list', () => {
        const bot = makeFakeBot();
        bot.findBlocks = () => { throw new Error('chunk'); };
        assert.deepEqual(D.findOpenables(bot, 6), []);
        assert.deepEqual(D.findOpenables(null, 6), []);
    });
});

describe('closeDoor and openDoor: the state is checked, not assumed', () => {
    test('closes an open door once and sees it closed', async () => {
        const { bot, world, door } = houseScene({ doorOpen: true, botAt: [4.5, 64, 9.5] });
        assert.equal(await D.closeDoor(bot, door, FAST), true);
        assert.equal(isOpen(world, 4, 64, 7), false);
        assert.equal(isOpen(world, 4, 65, 7), false, 'both halves');
        assert.equal(activations(bot).length, 1);
    });

    test('a closed door is not touched', async () => {
        const { bot, door } = houseScene({ botAt: [4.5, 64, 9.5] });
        assert.equal(await D.closeDoor(bot, door, FAST), true);
        assert.equal(activations(bot).length, 0);
    });

    test('waits for the block update that comes later', async () => {
        const { bot, world, door } = houseScene({ doorOpen: true, botAt: [4.5, 64, 9.5] });
        bot.activateDelayMs = 20;
        assert.equal(await D.closeDoor(bot, door, { checkMs: 200 }), true);
        assert.equal(activations(bot).length, 1);
        assert.equal(isOpen(world, 4, 64, 7), false);
    });

    test('tries up to 3 times, then reports false', async () => {
        const { bot, world, door } = houseScene({ doorOpen: true, botAt: [4.5, 64, 9.5] });
        bot.failActivations = 99;
        assert.equal(await D.closeDoor(bot, door, FAST), false);
        assert.equal(activations(bot).length, 3);
        assert.equal(isOpen(world, 4, 64, 7), true);
    });

    test('a lost first click is repeated', async () => {
        const { bot, world, door } = houseScene({ doorOpen: true, botAt: [4.5, 64, 9.5] });
        bot.failActivations = 1;
        assert.equal(await D.closeDoor(bot, door, FAST), true);
        assert.equal(activations(bot).length, 2);
        assert.equal(isOpen(world, 4, 64, 7), false);
    });

    test('the upper half as input works on the lower half', async () => {
        const { bot, world } = houseScene({ doorOpen: true, botAt: [4.5, 64, 9.5] });
        assert.equal(await D.closeDoor(bot, { x: 4, y: 65, z: 7 }, FAST), true);
        assert.deepEqual(activations(bot)[0].slice(1), [4, 64, 7]);
        assert.equal(isOpen(world, 4, 64, 7), false);
    });

    test('no door there, iron, a throwing activateBlock: false or retried, never a throw', async () => {
        const { bot, world } = houseScene({ botAt: [4.5, 64, 9.5] });
        assert.equal(await D.closeDoor(bot, { x: 20, y: 64, z: 20 }, FAST), false);
        world.door(10, 64, 10, { name: 'iron_door', open: true });
        assert.equal(await D.openDoor(bot, { x: 10, y: 64, z: 10 }, FAST), false);
        const { bot: b2, door } = houseScene({ doorOpen: true, botAt: [4.5, 64, 9.5] });
        b2.activateBlock = async () => { throw new Error('too far'); };
        assert.equal(await D.closeDoor(b2, door, FAST), false);
        assert.equal(await D.closeDoor(b2, null, FAST), false);
    });

    test('an interrupt stops closeDoor unless respectInterrupt is false', async () => {
        const { bot, door, world } = houseScene({ doorOpen: true, botAt: [4.5, 64, 9.5] });
        bot.interrupt_code = true;
        assert.equal(await D.closeDoor(bot, door, FAST), false);
        assert.equal(activations(bot).length, 0);
        assert.equal(await D.closeDoor(bot, door, { ...FAST, respectInterrupt: false }), true);
        assert.equal(isOpen(world, 4, 64, 7), false);
    });

    test('openDoor opens and checks, a fence gate too', async () => {
        const { bot, world, door } = houseScene({ botAt: [4.5, 64, 9.5] });
        assert.equal(await D.openDoor(bot, door, FAST), true);
        assert.equal(isOpen(world, 4, 64, 7), true);
        world.gate(10, 64, 10);
        assert.equal(await D.openDoor(bot, { x: 10, y: 64, z: 10 }, FAST), true);
        assert.equal(isOpen(world, 10, 64, 10), true);
    });
});

describe('doorIsSafe', () => {
    test('no monsters: safe', () => {
        const { bot, door, ctx } = houseScene();
        assert.equal(D.doorIsSafe(bot, door, ctx), true);
        assert.equal(D.doorDanger(bot, door, ctx), null);
    });

    test('a hostile mob within 16 blocks of the door: not safe', () => {
        const { bot, door, ctx } = houseScene();
        const zombie = addMob(bot, 'zombie', [4.5, 64, -8]);
        assert.equal(D.doorIsSafe(bot, door, ctx), false);
        assert.equal(D.doorDanger(bot, door, ctx).entity, zombie);
        const { bot: b2, ctx: c2 } = houseScene();
        addMob(b2, 'creeper', [20, 64, 7.5]);
        assert.equal(D.doorIsSafe(b2, door, c2), false, 'a creeper 15.5 blocks from the door');
    });

    test('peaceful-until-provoked mobs and animals do not count', () => {
        const { bot, door, ctx } = houseScene();
        addMob(bot, 'enderman', [4.5, 64, 9]);
        addMob(bot, 'zombified_piglin', [5.5, 64, 9]);
        addMob(bot, 'cow', [3.5, 64, 9], { type: 'animal' });
        assert.equal(D.doorIsSafe(bot, door, ctx), true);
    });

    test('within 24 blocks of the bot: only when it approaches', () => {
        const { bot, door, ctx } = houseScene({ botAt: [4.5, 64, 30.5] });
        const skeleton = addMob(bot, 'skeleton', [4.5, 64, 50], { velocity: [0, 0, -0.2] });
        assert.equal(D.doorIsSafe(bot, door, ctx), false, 'moving towards the bot');
        skeleton.velocity.z = 0.2;
        assert.equal(D.doorIsSafe(bot, door, ctx), true, 'moving away');
    });

    test('approaching is also seen from two looks at its position', () => {
        let t = 1000;
        const { bot, door } = houseScene({ botAt: [4.5, 64, 30.5] });
        const ctx = { now: () => t };
        const spider = addMob(bot, 'spider', [4.5, 64, 52]);
        assert.equal(D.doorIsSafe(bot, door, ctx), true, 'first look: standing');
        t += 1000;
        spider.position.z = 50;
        assert.equal(D.doorIsSafe(bot, door, ctx), false, 'second look: 2 blocks closer');
    });

    test('a mob farther than 24 blocks from the bot and 16 from the door: safe', () => {
        const { bot, door, ctx } = houseScene({ botAt: [4.5, 64, 30.5] });
        addMob(bot, 'zombie', [4.5, 64, 60], { velocity: [0, 0, -0.3] });
        assert.equal(D.doorIsSafe(bot, door, ctx), true);
    });
});

describe('passThrough', () => {
    test('walks to the door, opens it, walks through, closes it and checks', async () => {
        const { bot, world, area, ctx, door } = houseScene({ botAt: [4.5, 64, 12.5] });
        let passingSeen = false;
        bot.onActivate = () => { passingSeen = passingSeen || D.isPassingThrough(bot); };
        const res = await D.passThrough(bot, door, ctx, { ...FAST, inside: area });
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(res.reason, null);
        assert.ok(bot.entity.position.z < 7, `inside: ${bot.entity.position}`);
        assert.equal(isOpen(world, 4, 64, 7), false, 'closed behind');
        assert.equal(activations(bot).length, 2, 'open, close');
        assert.equal(bot.calls.some(c => c[0] === 'pf_open'), false, 'the pathfinder did not open it by itself');
        assert.equal(passingSeen, true);
        assert.equal(D.isPassingThrough(bot), false, 'flag cleared afterwards');
    });

    test('without inside: the other side as seen from the bot', async () => {
        const { bot, world, ctx, door } = houseScene({ botAt: [4.5, 64, 4.5] });
        const res = await D.passThrough(bot, door, ctx, FAST);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.ok(bot.entity.position.z > 8, 'outside now');
        assert.equal(isOpen(world, 4, 64, 7), false);
    });

    test('a fence gate works the same', async () => {
        const world = makeWorld();
        world.gate(0, 64, 0, { facing: 'south' });
        const bot = makeFakeBot({ world, pos: [0.5, 64, 4.5] });
        const res = await D.passThrough(bot, { x: 0, y: 64, z: 0 }, {}, FAST);
        assert.equal(res.ok, true);
        assert.ok(bot.entity.position.z < 0);
        assert.equal(isOpen(world, 0, 64, 0), false);
    });

    test('refuses with monster_near and does not open the door', async () => {
        const { bot, world, area, ctx, door } = houseScene();
        const zombie = addMob(bot, 'zombie', [10, 64, 12]);
        const res = await D.passThrough(bot, door, ctx, { ...FAST, inside: area });
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'monster_near');
        assert.equal(res.mob, zombie);
        assert.equal(activations(bot).length, 0);
        assert.equal(isOpen(world, 4, 64, 7), false);
    });

    test('a bot in a pit digs out as the last try, never next to a protected area (found on the real server)', async () => {
        const { bot, area, ctx, door, world } = houseScene({ botAt: [4.5, 64, 30.5] });
        const inner = bot.gotoImpl;
        let digMovements = null;
        bot.gotoImpl = async (goal) => {
            const m = bot.pathfinder.movements;
            if (!m.canDig && bot.entity.position.z > 20) {
                const e = new Error('No path');
                e.name = 'NoPath';
                throw e;
            }
            if (m.canDig) digMovements = m;
            await inner(goal);
        };
        const res = await D.passThrough(bot, door, ctx, { ...FAST, inside: area });
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.ok(digMovements, 'the third try may dig');
        const block = (x, y, z) => ({ position: { x, y, z } });
        assert.equal(digMovements.exclusionAreasBreak.reduce((w, f) => w + f(block(10, 64, 4)), 0), 100, '2 blocks beside the house box');
        assert.equal(digMovements.exclusionAreasBreak.reduce((w, f) => w + f(block(4, 64, 30)), 0), 0, 'far from the house');
        assert.equal(digMovements.allow1by1towers, false);
        assert.deepEqual(digMovements.scafoldingBlocks, []);
        assert.equal(isOpen(world, 4, 64, 7), false);
        const s2 = houseScene({ botAt: [4.5, 64, 30.5] });
        s2.bot.gotoImpl = async () => { if (s2.bot.pathfinder.movements.canDig) throw new Error('must not dig'); const e = new Error('x'); e.name = 'NoPath'; throw e; };
        const r2 = await D.passThrough(s2.bot, s2.door, s2.ctx, { ...FAST, inside: s2.area, allowDig: false });
        assert.equal(r2.reason, 'no_path', 'allowDig false: never digs');
    });

    test('a monster that comes while the bot walks: refused at the door', async () => {
        const { bot, area, ctx, door } = houseScene({ botAt: [4.5, 64, 30.5] });
        const inner = bot.gotoImpl;
        bot.gotoImpl = async (goal) => {
            await inner(goal);
            if (!bot.entities[500]) bot.entities[500] = { id: 500, name: 'husk', type: 'hostile', position: bot.entity.position.offset(6, 0, 0), velocity: bot.entity.velocity, metadata: {} };
        };
        const res = await D.passThrough(bot, door, ctx, { ...FAST, inside: area });
        assert.equal(res.reason, 'monster_near');
        assert.equal(activations(bot).length, 0);
    });

    test('no way to the door: no_path, the door is not touched', async () => {
        const { bot, area, ctx, door } = houseScene();
        bot.gotoImpl = async () => { const e = new Error('No path'); e.name = 'NoPath'; throw e; };
        const res = await D.passThrough(bot, door, ctx, { ...FAST, inside: area });
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'no_path');
        assert.equal(activations(bot).length, 0);
    });

    test('something in the doorway: blocked, and the door it opened is closed again', async () => {
        const { bot, world, area, ctx, door } = houseScene();
        bot.blocked.add('4,64,7');
        const res = await D.passThrough(bot, door, ctx, { ...FAST, inside: area });
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'blocked');
        assert.equal(isOpen(world, 4, 64, 7), false);
        assert.equal(activations(bot).length, 2);
    });

    test('a door that does not open: blocked', async () => {
        const { bot, area, ctx, door } = houseScene();
        bot.failActivations = 99;
        const res = await D.passThrough(bot, door, ctx, { ...FAST, inside: area });
        assert.equal(res.reason, 'blocked');
    });

    test('a door that does not close: could_not_close', async () => {
        const { bot, area, ctx, door, world } = houseScene();
        bot.onActivate = () => {
            if (activations(bot).length >= 2) bot.failActivations = 99;
        };
        const res = await D.passThrough(bot, door, ctx, { ...FAST, inside: area });
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'could_not_close');
        assert.equal(isOpen(world, 4, 64, 7), true);
        assert.ok(bot.entity.position.z < 7, 'the bot is inside');
    });

    test('an interrupt ends it, the door it opened is closed', async () => {
        const { bot, area, ctx, door, world } = houseScene();
        bot.onActivate = () => { bot.interrupt_code = true; };
        const res = await D.passThrough(bot, door, ctx, { ...FAST, inside: area });
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'interrupted');
        assert.equal(isOpen(world, 4, 64, 7), false);
    });

    test('a bot behind the opposite wall is not "through": it walks round to the door (found on the real server)', async () => {
        // The door is in the south wall; the bot stands west of the house, on the inner side of the
        // door's plane but outside the walls.
        const { bot, area, ctx, door, world } = houseScene({ botAt: [-10.5, 64, 4.5] });
        const res = await D.passThrough(bot, door, ctx, { ...FAST, inside: area });
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(activations(bot).length, 2, 'opened and closed');
        assert.ok(bot.entity.position.z < 7 && bot.entity.position.x > 1, `inside: ${bot.entity.position}`);
        assert.equal(isOpen(world, 4, 64, 7), false);
        const s2 = houseScene({ botAt: [4.5, 64, -20.5] });
        await D.passThrough(s2.bot, s2.door, s2.ctx, FAST);
        assert.ok(s2.bot.calls.some(c => c[0] === 'goto'), 'without an area: far from the door means not through');
    });

    test('the bot already on the far side: the door is only closed', async () => {
        const { bot, area, ctx, door, world } = houseScene({ botAt: [4.5, 64, 5.5], doorOpen: true });
        const res = await D.passThrough(bot, door, ctx, { ...FAST, inside: area });
        assert.equal(res.ok, true);
        assert.equal(isOpen(world, 4, 64, 7), false);
        assert.equal(bot.calls.filter(c => c[0] === 'goto').length, 0);
    });

    test('an open door is walked through and closed', async () => {
        const { bot, area, ctx, door, world } = houseScene({ doorOpen: true });
        const res = await D.passThrough(bot, door, ctx, { ...FAST, inside: area });
        assert.equal(res.ok, true);
        assert.equal(isOpen(world, 4, 64, 7), false);
        assert.equal(activations(bot).length, 1);
    });

    test('no door, a trapdoor, an unloaded block', async () => {
        const { bot, ctx, world } = houseScene();
        assert.equal((await D.passThrough(bot, { x: 30, y: 64, z: 30 }, ctx, FAST)).reason, 'blocked');
        world.set(20, 64, 20, 'oak_trapdoor', { facing: 'north', half: 'bottom', open: false });
        assert.equal((await D.passThrough(bot, { x: 20, y: 64, z: 20 }, ctx, FAST)).reason, 'blocked');
        world.unloaded = (x) => x > 100;
        assert.equal((await D.passThrough(bot, { x: 200, y: 64, z: 0 }, ctx, FAST)).reason, 'no_path');
        assert.equal((await D.passThrough(bot, null, ctx, FAST)).reason, 'blocked');
    });

    test('every result has a text', async () => {
        const { bot, area, ctx, door } = houseScene();
        const res = await D.passThrough(bot, door, ctx, { ...FAST, inside: area });
        assert.equal(typeof res.text, 'string');
        assert.ok(res.text.length > 0);
    });
});

describe('closeDoorsBehind', () => {
    function walkAwayScene() {
        const scene = houseScene({ doorOpen: true, botAt: [4.5, 64, 7.5] });
        let t = 0;
        scene.tracker = new L.DoorTracker({ now: () => t });
        scene.at = (ms, z) => {
            t = ms;
            scene.bot.entity.position.z = z;
        };
        return scene;
    }

    test('closes the door the bot walked away from', async () => {
        const { bot, tracker, at, world, ctx } = walkAwayScene();
        at(0, 7.5);
        assert.deepEqual(await D.closeDoorsBehind(bot, tracker, ctx, FAST), []);
        at(200, 9.2); // 1.7 blocks from the door: the 0.5 s of H1 apply
        await D.closeDoorsBehind(bot, tracker, ctx, FAST);
        at(800, 10.2);
        const closed = await D.closeDoorsBehind(bot, tracker, ctx, FAST);
        assert.equal(closed.length, 1);
        assert.equal(isOpen(world, 4, 64, 7), false);
    });

    test('closes even after !stop left interrupt_code set', async () => {
        const { bot, tracker, at, world, ctx } = walkAwayScene();
        bot.interrupt_code = true;
        at(0, 7.5);
        await D.closeDoorsBehind(bot, tracker, ctx, FAST);
        at(200, 9.2);
        await D.closeDoorsBehind(bot, tracker, ctx, FAST);
        at(800, 10.2);
        assert.equal((await D.closeDoorsBehind(bot, tracker, ctx, FAST)).length, 1);
        assert.equal(isOpen(world, 4, 64, 7), false);
    });

    test('a player in the doorway keeps it open', async () => {
        const { bot, tracker, at, world, ctx } = walkAwayScene();
        addPlayer(bot, 'alex', [4.5, 64, 7.5]);
        at(0, 7.5);
        await D.closeDoorsBehind(bot, tracker, ctx, FAST);
        at(200, 10);
        await D.closeDoorsBehind(bot, tracker, ctx, FAST);
        at(800, 10.2);
        assert.deepEqual(await D.closeDoorsBehind(bot, tracker, ctx, FAST), []);
        assert.equal(isOpen(world, 4, 64, 7), true);
    });

    test('does nothing while passThrough runs', async () => {
        const { bot, area, ctx, door } = houseScene();
        const tracker = { observe() { throw new Error('must not be called'); } };
        let during = null;
        bot.onActivate = () => { during = during ?? D.closeDoorsBehind(bot, tracker, ctx, FAST); };
        await D.passThrough(bot, door, ctx, { ...FAST, inside: area });
        assert.deepEqual(await during, []);
    });

    test('a broken tracker or bot: empty list', async () => {
        const { bot, ctx } = houseScene();
        assert.deepEqual(await D.closeDoorsBehind(bot, { observe() { throw new Error('x'); } }, ctx, FAST), []);
        assert.deepEqual(await D.closeDoorsBehind(null, new L.DoorTracker(), ctx, FAST), []);
    });
});
