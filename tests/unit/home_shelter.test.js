// Spec v0.1.4.6 H3: src/agent/packs/home/shelter.js -- goToShelter, emergencyShelter, isInShelter.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { makeWorld, makeFakeBot, buildHouse, addMob, removeEntity, give, makeSim } from './home_fake_bot.test.js';

const S = await loadSrc('src/agent/packs/home/shelter.js');
const K = await loadSrc('src/agent/packs/home/creeper.js');
const L = await loadSrc('src/agent/packs/home/shelter_logic.js');
const G = await loadSrc('src/agent/packs/home/box_math.js');

const FAST = { checkMs: 40 };
const isOpen = (world, x, y, z) => world.propsAt(x, y, z).open === true;
const activations = bot => bot.calls.filter(c => c[0] === 'activate');

function scene({ botAt = [4.5, 64, 47.5], house = true, places = null, areas = null } = {}) {
    const world = makeWorld();
    const area = house ? buildHouse(world) : null;
    const bot = makeFakeBot({ world, pos: botAt });
    const logs = [];
    const ctx = { areas: areas ?? (area ? [area] : []), places, settings: {}, log: t => logs.push(t), now: () => Date.now() };
    return { world, area, bot, ctx, logs };
}

describe('isInShelter and bedInShelter', () => {
    test('inside the walls of a building area', () => {
        const { bot, ctx } = scene({ botAt: [4.5, 64, 4.5] });
        assert.equal(S.isInShelter(bot, ctx), true);
        bot.entity.position.z = 8.5;
        assert.equal(S.isInShelter(bot, ctx), false, 'in front of the door');
    });

    test('a farm is no shelter; another dimension does not count', () => {
        const { bot, ctx, area } = scene({ botAt: [4.5, 64, 4.5] });
        ctx.areas = [{ ...area, type: 'farm' }];
        assert.equal(S.isInShelter(bot, ctx), false);
        ctx.areas = [{ ...area, dimension: 'the_nether' }];
        assert.equal(S.isInShelter(bot, ctx), false);
    });

    test('ctx.areas may be a store with list() or a function returning it', () => {
        const { bot, area } = scene({ botAt: [4.5, 64, 4.5] });
        assert.equal(S.isInShelter(bot, { areas: { list: () => [area] } }), true);
        assert.equal(S.isInShelter(bot, { areas: () => ({ list: () => [area] }) }), true);
        assert.equal(S.isInShelter(bot, { areas: { list() { throw new Error('disk'); } } }), false);
        assert.equal(S.isInShelter(null, {}), false);
    });

    test('bedInShelter finds a bed inside the building the bot is in', () => {
        const { bot, ctx, world } = scene({ botAt: [4.5, 64, 4.5] });
        assert.equal(S.bedInShelter(bot, ctx), null);
        world.bed(2, 64, 2, { facing: 'east' });
        assert.ok(S.bedInShelter(bot, ctx));
        bot.entity.position.z = 30;
        assert.equal(S.bedInShelter(bot, ctx), null, 'outside');
    });
});

describe('goToShelter', () => {
    test('from 40 blocks away: inside the house, the door closed and checked', async () => {
        const { bot, ctx, world, area } = scene();
        const res = await S.goToShelter(bot, ctx, FAST);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(res.where, 'home');
        assert.equal(res.text, 'I am in the shelter "home". The door is closed.');
        assert.equal(L.isInsideArea(area, bot.entity.position), true);
        assert.equal(isOpen(world, 4, 64, 7), false);
        const spot = bot.entity.position.floored();
        assert.ok(Math.hypot(spot.x - 4, spot.z - 7) >= 3.9, `away from the door: ${spot}`);
    });

    test('already inside: the text of the spec, nothing moves', async () => {
        const { bot, ctx } = scene({ botAt: [4.5, 64, 4.5] });
        const res = await S.goToShelter(bot, ctx, FAST);
        assert.deepEqual({ ok: res.ok, text: res.text }, { ok: true, text: 'I am in the shelter already.' });
        assert.equal(bot.calls.filter(c => c[0] === 'goto').length, 0);
    });

    test('monsters at the door: 3 tries with moving away, then the text of the spec', async () => {
        const { bot, ctx, world } = scene();
        addMob(bot, 'zombie', [4.5, 64, 12]);
        const res = await S.goToShelter(bot, ctx, FAST);
        assert.equal(res.ok, false);
        assert.equal(res.text, 'I cannot get into the shelter. Monsters are at the door.');
        assert.equal(activations(bot).length, 0, 'never opened the door');
        assert.equal(isOpen(world, 4, 64, 7), false);
        const away = bot.calls.filter(c => c[0] === 'goto' && c[1]?.goal);
        assert.equal(away.length, 3, 'moved away 3 times');
        assert.ok(bot.entity.position.distanceTo({ x: 4.5, y: 64, z: 12 }) >= 20);
    });

    test('a monster that leaves: the second try gets in', async () => {
        const { bot, ctx, world } = scene();
        const zombie = addMob(bot, 'zombie', [4.5, 64, 12]);
        const inner = bot.gotoImpl;
        bot.gotoImpl = async (goal) => {
            await inner(goal);
            if (goal.goal) removeEntity(bot, zombie);
        };
        const res = await S.goToShelter(bot, ctx, FAST);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(isOpen(world, 4, 64, 7), false);
    });

    test('a creeper near: the creeper procedure first, the door only when it is gone', async () => {
        const { bot, ctx, world } = scene({ botAt: [4.5, 64, 30.5] });
        const creeper = addMob(bot, 'creeper', [4.5, 64, 36]);
        const sim = makeSim(bot, { onStep: (s) => { if (s.steps === 6) removeEntity(bot, creeper); } });
        let creeperAtDoor = false;
        bot.onActivate = () => { creeperAtDoor = creeperAtDoor || creeper.isValid; };
        const res = await S.goToShelter(bot, { ...ctx, now: sim.now }, { ...FAST, now: sim.now, wait: sim.wait });
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.ok(sim.steps >= 6, 'the procedure ran');
        assert.equal(creeperAtDoor, false);
        assert.equal(isOpen(world, 4, 64, 7), false);
    });

    test('a door that cannot be closed: not ok, and the text says so', async () => {
        const { bot, ctx } = scene();
        bot.onActivate = () => { if (activations(bot).length >= 2) bot.failActivations = 99; };
        const res = await S.goToShelter(bot, ctx, FAST);
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'could_not_close');
        assert.match(res.text, /could not close the door/);
    });

    test('no way to the door: not ok', async () => {
        const { bot, ctx } = scene();
        bot.gotoImpl = async () => { const e = new Error('no'); e.name = 'NoPath'; throw e; };
        const res = await S.goToShelter(bot, ctx, FAST);
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'no_path');
        assert.match(res.text, /cannot get into the shelter "home"/);
    });

    test('an interrupt ends it', async () => {
        const { bot, ctx } = scene();
        bot.gotoImpl = async () => { bot.interrupt_code = true; };
        const res = await S.goToShelter(bot, ctx, FAST);
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'interrupted');
    });

    test('an area without entrances: to the centre, the pathfinder opens, the door is closed after', async () => {
        const { bot, ctx, world, area } = scene();
        ctx.areas = [{ ...area, entrances: [] }];
        const res = await S.goToShelter(bot, ctx, FAST);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(L.isInsideArea(area, bot.entity.position), true);
        assert.ok(bot.calls.some(c => c[0] === 'pf_open'), 'the pathfinder opened the door');
        assert.equal(isOpen(world, 4, 64, 7), false);
        assert.equal(res.text, 'I am in the shelter "home". The door is closed.');
    });

    test('the order of the spec: the building with the place home comes before the nearest one', async () => {
        const { bot, area } = scene({ botAt: [60.5, 64, 60.5] });
        const shed = { ...area, name: 'shed', min: { x: 50, y: 63, z: 50 }, max: { x: 58, y: 69, z: 58 }, entrances: [] };
        const cabin = { ...area, name: 'cabin' };
        const ctx = { areas: [shed, cabin], places: { recall: n => (n === 'home' ? { x: 4.5, y: 64, z: 4.5, dimension: 'overworld' } : undefined) } };
        assert.equal(S.findShelter(bot, ctx).area.name, 'cabin');
        assert.equal(S.findShelter(bot, { areas: [shed, cabin] }).area.name, 'shed', 'without the place: the nearest');
        assert.equal(S.findShelter(bot, { areas: [shed, area] }).area.name, 'home', 'the area named home beats the nearest');
    });

    test('the place home without an area', async () => {
        const places = { recallPlaceInfo: n => (n === 'home' ? { x: 50.5, y: 64, z: 50.5, dimension: 'overworld' } : undefined) };
        const { bot, ctx } = scene({ house: false, places, botAt: [10.5, 64, 10.5] });
        const res = await S.goToShelter(bot, ctx, FAST);
        assert.equal(res.ok, true);
        assert.equal(res.where, 'home');
        assert.equal(res.text, 'I am at the place "home". I know no building around it.');
        assert.ok(bot.entity.position.distanceTo({ x: 50.5, y: 64, z: 50.5 }) < 2);
    });

    test('nothing at all: an emergency shelter', async () => {
        const { bot, ctx } = scene({ house: false, botAt: [20.5, 64, 20.5] });
        give(bot, 'dirt', 4);
        const res = await S.goToShelter(bot, ctx, FAST);
        assert.equal(res.ok, true);
        assert.equal(res.where, 'emergency');
    });

    test('a broken context never throws', async () => {
        const { bot } = scene();
        const res = await S.goToShelter(bot, { areas: { list() { throw new Error('x'); } } }, FAST);
        assert.equal(typeof res.ok, 'boolean');
        const r2 = await S.goToShelter(null, null, FAST);
        assert.equal(r2.ok, false);
    });
});

// Amendment 2, F3: a creeper that stands near the house and does not follow (the procedure ended with
// leave_it). goToShelter uses an entrance at least 16 blocks from every creeper; without one it does
// not go in, and at night it digs in at least 24 blocks from the creeper.
describe('goToShelter with a standing creeper (F3)', () => {
    const STANDS = 'A creeper stands near the shelter "home". I do not go in while it is there.';
    function standing(bot, pos) {
        const creeper = addMob(bot, 'creeper', pos);
        K.creeperMemory(bot).watch.note({ step: 'leave_it', creeper: creeper.id }, Date.now());
        return creeper;
    }

    test('day, the creeper 10 blocks from the only door: the bot does not go in', async () => {
        const { bot, ctx, world } = scene();
        standing(bot, [4.5, 64, 18]);
        const res = await S.goToShelter(bot, ctx, FAST);
        assert.equal(res.ok, false, JSON.stringify(res));
        assert.equal(res.reason, 'creeper_standing');
        assert.equal(res.text, STANDS);
        assert.equal(activations(bot).length, 0, 'never opened the door');
        assert.equal(isOpen(world, 4, 64, 7), false);
    });

    test('night: it digs in at least 24 blocks from the creeper', async () => {
        const { bot, ctx } = scene({ botAt: [4.5, 64, 30.5] });
        bot.time.timeOfDay = 14000;
        give(bot, 'dirt', 4);
        const creeper = standing(bot, [4.5, 64, 18]);
        const res = await S.goToShelter(bot, ctx, FAST);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(res.where, 'emergency');
        assert.ok(bot.entity.position.distanceTo(creeper.position) >= 24, `distance ${bot.entity.position.distanceTo(creeper.position)}`);
        assert.equal(activations(bot).length, 0, 'never opened the door');
    });

    test('a second entrance far from the creeper: the bot goes in there, although the other is nearer', async () => {
        const { bot, ctx, world, area } = scene({ botAt: [20.5, 64, 12.5] });
        world.door(4, 64, 1, { facing: 'north' });
        ctx.areas = [{ ...area, entrances: [{ x: 4, y: 64, z: 7, kind: 'door' }, { x: 4, y: 64, z: 1, kind: 'door' }] }];
        standing(bot, [4.5, 64, 18]);
        const res = await S.goToShelter(bot, ctx, FAST);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.ok(activations(bot).every(c => c[3] === 1), 'only the north door was used');
        assert.equal(isOpen(world, 4, 64, 1), false);
        assert.equal(isOpen(world, 4, 64, 7), false);
    });

    test('a standing creeper 16 blocks or more from the door: in as usual', async () => {
        const { bot, ctx, world } = scene();
        standing(bot, [30.5, 64, 7.5]);
        const res = await S.goToShelter(bot, ctx, FAST);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(isOpen(world, 4, 64, 7), false);
    });
});

describe('the standing place in the house of tests/helpers/block_world.js', () => {
    test('free, inside the room, not on the bed or the chest, not in the doorway', () => {
        const world = createBlockWorld().flatGround(63);
        const house = world.house({ x: 0, y: 63, z: 0 });
        const area = { name: 'home', type: 'building', min: { x: house.min.x - 1, y: house.min.y - 1, z: house.min.z - 1 },
            max: { x: house.max.x + 1, y: house.max.y + 1, z: house.max.z + 1 }, entrances: [{ ...house.door, kind: 'door' }] };
        const isFree = S.standingTest({ blockAt: (p) => world.blockAt(p) });
        const spot = L.chooseStandingPlace({ area, entrance: house.door, isFree });
        assert.ok(spot);
        assert.ok(spot.x >= house.interior.min.x && spot.x <= house.interior.max.x, JSON.stringify(spot));
        assert.ok(spot.z >= house.interior.min.z && spot.z <= house.interior.max.z);
        assert.equal(spot.y, house.inside.y);
        for (const b of [...house.bed, house.chest]) {
            assert.notDeepEqual({ x: spot.x, z: spot.z }, { x: b.x, z: b.z });
        }
        assert.ok(Math.hypot(spot.x - house.door.x, spot.z - house.door.z) >= 2);
    });
});

describe('emergencyShelter', () => {
    test('digs 3 blocks down and closes the hole with dirt', async () => {
        const { bot, ctx, world } = scene({ house: false, botAt: [20.5, 64, 20.5] });
        give(bot, 'cobblestone', 2);
        give(bot, 'dirt', 2);
        const res = await S.emergencyShelter(bot, ctx, FAST);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(res.text, 'I have no shelter. I dug in at (20, 61, 20) and closed the hole.');
        assert.deepEqual(bot.calls.filter(c => c[0] === 'dig').map(c => c[2]), [63, 62, 61]);
        assert.equal(world.nameAt(20, 63, 20), 'dirt', 'the hole above the head is closed');
        assert.equal(world.nameAt(20, 62, 20), 'air');
    });

    test('water under the column: moves 3 blocks and starts again', async () => {
        const { bot, ctx, world } = scene({ house: false, botAt: [20.5, 64, 20.5] });
        world.set(20, 60, 20, 'water');
        give(bot, 'dirt', 2);
        const res = await S.emergencyShelter(bot, ctx, FAST);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(bot.calls.filter(c => c[0] === 'dig' && c[1] === 20 && c[3] === 20).length, 0, 'never dug above the water');
        assert.ok(Math.abs(Math.floor(bot.entity.position.x) - 20) === 3 || Math.abs(Math.floor(bot.entity.position.z) - 20) === 3);
    });

    test('never digs inside a protected area', async () => {
        const farm = { name: 'field', type: 'farm', min: { x: 10, y: 60, z: 10 }, max: { x: 20, y: 70, z: 20 } };
        const { bot, ctx } = scene({ house: false, botAt: [19.5, 64, 15.5], areas: [farm] });
        give(bot, 'dirt', 2);
        const res = await S.emergencyShelter(bot, ctx, FAST);
        assert.equal(res.ok, true, JSON.stringify(res));
        const box = G.expandBox(farm, 1);
        assert.equal(bot.calls.some(c => c[0] === 'dig' && G.containsPos(box, { x: c[1], y: c[2], z: c[3] })), false);
    });

    test('no place anywhere: not ok, no digging', async () => {
        const farm = { name: 'field', type: 'farm', min: { x: 0, y: 50, z: 0 }, max: { x: 40, y: 70, z: 40 } };
        const { bot, ctx } = scene({ house: false, botAt: [20.5, 64, 20.5], areas: [farm] });
        const res = await S.emergencyShelter(bot, ctx, FAST);
        assert.equal(res.ok, false);
        assert.equal(res.text, 'I have no shelter and found no place to dig in.');
        assert.equal(bot.calls.some(c => c[0] === 'dig'), false);
    });

    test('no block to close the hole, sand is not used', async () => {
        const { bot, ctx, world } = scene({ house: false, botAt: [20.5, 64, 20.5] });
        give(bot, 'sand', 5);
        const res = await S.emergencyShelter(bot, ctx, FAST);
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'no_block');
        assert.equal(res.text, 'I have no shelter. I dug in at (20, 61, 20), but I have no block to close the hole.');
        assert.equal(world.nameAt(20, 63, 20), 'air');
    });

    test('any full block when there is no dirt or cobblestone', async () => {
        const { bot, ctx, world } = scene({ house: false, botAt: [20.5, 64, 20.5] });
        give(bot, 'torch', 5);
        give(bot, 'oak_planks', 1);
        const res = await S.emergencyShelter(bot, ctx, FAST);
        assert.equal(res.ok, true);
        assert.equal(world.nameAt(20, 63, 20), 'oak_planks');
    });

    test('a failing dig and an interrupt', async () => {
        const { bot, ctx } = scene({ house: false, botAt: [20.5, 64, 20.5] });
        bot.digError = 'too hard';
        const res = await S.emergencyShelter(bot, ctx, FAST);
        assert.equal(res.ok, false);
        const s2 = scene({ house: false, botAt: [20.5, 64, 20.5] });
        s2.bot.interrupt_code = true;
        const r2 = await S.emergencyShelter(s2.bot, s2.ctx, FAST);
        assert.equal(r2.reason, 'interrupted');
    });
});
