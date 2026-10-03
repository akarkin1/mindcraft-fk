// Spec v0.1.4.7 F2: the executing functions of the farming pack (farming.js) on the fake bot of the
// home pack: harvest, plant, bone meal, fertilize and the farm cycle, the gate and the guard.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { addPlayer, give, makeFakeBot, makeSim, makeWorld, v } from './home_fake_bot.test.js';
import { installAreaGuard } from '../../src/agent/areas/area_guard.js';
import { isPassingThrough } from '../../src/agent/packs/home/doors.js';
import {
    FARM_LIMITS, farmCycle, fertilize, fieldMovements, findFarm, harvestCrops, makeBoneMeal, plantField,
} from '../../src/agent/packs/farming/farming.js';
import { TEXTS } from '../../src/agent/packs/farming/texts.js';

const SEED_OF = { wheat_seeds: 'wheat', carrot: 'carrots', potato: 'potatoes', beetroot_seeds: 'beetroots' };
const RIPE = { wheat: 7, carrots: 7, potatoes: 7, beetroots: 3 };
const DROPS = { wheat: [['wheat', 1], ['wheat_seeds', 2]], carrots: [['carrot', 3]], potatoes: [['potato', 2]], beetroots: [['beetroot', 1], ['beetroot_seeds', 1]] };
const COMPOSTABLE = new Set(['oak_leaves', 'short_grass', 'poppy', 'dandelion', 'oak_sapling', 'hay_block']);

function add(bot, name, n = 1) {
    const it = bot.inventory.list.find(i => i.name === name);
    if (it) it.count += n;
    else give(bot, name, n);
}

function countOf(bot, name) {
    return bot.inventory.list.filter(i => i.name === name).reduce((s, i) => s + i.count, 0);
}

// The game rules the pack relies on, on top of the fake bot: seeds on farmland, a hoe on dirt,
// bone meal on crops, the composter, and the drops of a broken crop (picked up at once).
function installFarmSim(bot, { compost = () => true } = {}) {
    const world = bot.world;
    bot.readyComposters = [];
    bot.unequip = (dest) => {
        bot.calls.push(['unequip', dest]);
        bot.heldItem = null;
        return Promise.resolve();
    };
    bot.onActivate = (block) => {
        const p = block.position;
        const name = world.nameAt(p.x, p.y, p.z);
        const props = world.propsAt(p.x, p.y, p.z);
        const held = bot.heldItem && bot.heldItem.count > 0 ? bot.heldItem : null;
        const above = world.nameAt(p.x, p.y + 1, p.z);
        if (name === 'composter') {
            const level = props.level ?? 0;
            if (level === 8) {
                world.setProps(p.x, p.y, p.z, { level: 0 });
                add(bot, 'bone_meal', 1);
            } else if (held && COMPOSTABLE.has(held.name) && level < 7) {
                held.count--;
                if (compost()) {
                    world.setProps(p.x, p.y, p.z, { level: level + 1 });
                    if (level + 1 === 7) bot.readyComposters.push(p);
                }
            }
            return;
        }
        if (!held) return;
        if (SEED_OF[held.name] && name === 'farmland' && above === 'air') {
            world.set(p.x, p.y + 1, p.z, SEED_OF[held.name], { age: 0 });
            held.count--;
        } else if (held.name.endsWith('_hoe') && above === 'air' && ['grass_block', 'dirt', 'dirt_path', 'coarse_dirt'].includes(name)) {
            world.set(p.x, p.y, p.z, name === 'coarse_dirt' ? 'dirt' : 'farmland', { moisture: 0 });
        } else if (held.name === 'bone_meal' && RIPE[name] !== undefined && (props.age ?? 0) < RIPE[name]) {
            world.setProps(p.x, p.y, p.z, { age: Math.min(RIPE[name], (props.age ?? 0) + 3) });
            held.count--;
        }
    };
    const baseDig = bot.dig;
    bot.dig = async (block) => {
        const p = block.position;
        const name = world.nameAt(p.x, p.y, p.z);
        const props = world.propsAt(p.x, p.y, p.z);
        await baseDig(block);
        if (RIPE[name] !== undefined) {
            if ((props.age ?? 0) >= RIPE[name]) for (const [item, n] of DROPS[name]) add(bot, item, n);
            else add(bot, Object.keys(SEED_OF).find(s => SEED_OF[s] === name), 1);
        } else if (name === 'poppy' || name === 'dandelion') {
            add(bot, name, 1);
        } else if ((name === 'oak_leaves' || name === 'short_grass') && bot.heldItem?.name === 'shears') {
            add(bot, name, 1);
        }
    };
}

function sim(bot, extra = null) {
    return makeSim(bot, {
        onStep() {
            for (const p of bot.readyComposters.splice(0)) bot.world.setProps(p.x, p.y, p.z, { level: 8 });
            if (extra) extra();
        },
    });
}

/**
 * A fenced field on the grass at y 63: farmland at x 0..w-1, z 0..d-1, crops at y 64 from `ages`
 * (a function of x, z giving an age, or null for no crop), a fence ring at y 64 and a closed gate
 * at (0, 64, d) facing south. The fence blocks the straight walks of the fake pathfinder.
 */
function farm({ w = 2, d = 5, crop = 'wheat', ages = () => 7, ground = () => 'farmland', gate = true, name = 'wheat_farm', pos = null } = {}) {
    const world = makeWorld();
    for (let x = 0; x < w; x++) {
        for (let z = 0; z < d; z++) {
            const g = ground(x, z);
            world.set(x, 63, z, g, g === 'farmland' ? { moisture: 7 } : {});
            const age = g === 'farmland' ? ages(x, z) : null;
            if (age !== null && age !== undefined) world.set(x, 64, z, crop, { age });
        }
    }
    const bot = makeFakeBot({ world, pos: pos ?? [0.5, 64, d + 3.5] });
    for (let x = -1; x <= w; x++) {
        for (let z = -1; z <= d; z++) {
            if (x !== -1 && x !== w && z !== -1 && z !== d) continue;
            if (gate && x === 0 && z === d) {
                world.gate(0, 64, d, { facing: 'south' });
                continue;
            }
            world.set(x, 64, z, 'oak_fence');
            bot.blocked.add(`${x},64,${z}`);
        }
    }
    installFarmSim(bot);
    const area = {
        name, type: 'farm', dimension: 'overworld', source: 'scan',
        min: { x: -1, y: 62, z: -1 }, max: { x: w, y: 66, z: d }, entrances: gate ? [{ x: 0, y: 64, z: d, kind: 'gate' }] : [],
    };
    return { world, bot, area, ctx: { areas: [area] } };
}

function cropsAt(world, w, d) {
    const out = [];
    for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) out.push([x, z, world.nameAt(x, 64, z), world.propsAt(x, 64, z).age ?? null]);
    return out;
}

function farmlandCount(world, w, d) {
    let n = 0;
    for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) if (world.nameAt(x, 63, z) === 'farmland') n++;
    return n;
}

function digs(bot) {
    return bot.calls.filter(c => c[0] === 'dig').map(c => [c[1], c[2], c[3]]);
}

function gateOpen(world, d) {
    return world.propsAt(0, 64, d).open === true;
}

describe('findFarm', () => {
    test('a named farm, the nearest farm, a scan, or the text of the spec', () => {
        const { bot, area, ctx } = farm();
        assert.equal(findFarm(bot, ctx, 'Wheat_Farm').farm.name, 'wheat_farm');
        assert.equal(findFarm(bot, ctx, '').farm.name, 'wheat_farm');
        const unknown = findFarm(bot, ctx, 'carrots');
        assert.equal(unknown.ok, false);
        assert.equal(unknown.text, 'I know no farm "carrots". I know the farms "wheat_farm".');
        const far = { ...area, min: { x: 100, y: 62, z: 0 }, max: { x: 104, y: 66, z: 4 } };
        assert.equal(findFarm(bot, { areas: [far] }, '').text, TEXTS.noFarm, 'outside the fence nothing is scanned');
        bot.entity.position = v(1.5, 63.9375, 2.5);
        const scanned = findFarm(bot, { areas: [far] }, '');
        assert.equal(scanned.ok, true);
        assert.equal(scanned.farm.name, null);
        assert.deepEqual(scanned.farm.gates, [{ x: 0, y: 64, z: 5, kind: 'gate' }]);
        assert.equal(findFarm(null, {}, '').text, TEXTS.noFarm);
    });
});

describe('harvestCrops', () => {
    test('the field of the owner: ripe wheat is taken and planted again, unripe stays, the gate is closed', async () => {
        const ages = (x, z) => ((x + z) % 3 === 0 ? 2 : 7);
        const { world, bot, ctx } = farm({ ages });
        const before = cropsAt(world, 2, 5);
        const ripe = before.filter(c => c[3] === 7).length;
        const unripe = before.filter(c => c[3] === 2).length;
        const inField = [];
        const base = bot.gotoImpl;
        bot.gotoImpl = (goal) => {
            const m = bot.pathfinder.movements;
            if (!isPassingThrough(bot) && goal.x >= 0 && goal.x < 2 && goal.z >= 0 && goal.z < 5) inField.push(m);
            return base(goal);
        };
        const s = sim(bot);
        const res = await harvestCrops(bot, ctx, '', { now: s.now, wait: s.wait });
        assert.equal(res.ok, true, res.text);
        assert.equal(res.text, `I harvested ${ripe} wheat and planted ${ripe} again. ${unripe} plants are not ripe yet.`);
        assert.equal(res.harvested, ripe);
        assert.equal(res.replanted, ripe);
        for (const [x, z, name, age] of cropsAt(world, 2, 5)) {
            assert.equal(name, 'wheat');
            const was = before.find(c => c[0] === x && c[1] === z)[3];
            assert.equal(age, was === 7 ? 0 : 2, `the plant at ${x}, ${z}`);
        }
        assert.ok(digs(bot).every(([x, y, z]) => y === 64 && before.find(c => c[0] === x && c[1] === z)[3] === 7), 'only ripe plants are broken');
        assert.equal(farmlandCount(world, 2, 5), 10);
        assert.equal(gateOpen(world, 5), false, 'the gate is closed');
        assert.ok(bot.entity.position.z > 5, 'the bot left the field');
        assert.ok(countOf(bot, 'wheat') === ripe);
        assert.ok(inField.length > 0);
        for (const m of inField) {
            assert.equal(m.allowSprinting, false);
            assert.equal(m.allowParkour, false);
            assert.equal(m.canDig, false);
            assert.equal(m.canOpenDoors, false);
            assert.equal(m.allow1by1towers, false);
            assert.ok(m.exclusionAreasStep.some(fn => fn({ position: v(1, 66, 1) }) >= 100), 'no jump over the field');
            assert.ok(m.exclusionAreasPlace.some(fn => fn({ position: v(1, 64, 1) }) >= 100), 'no placing');
        }
        assert.ok(bot.modes.paused.includes('unstuck'));
    });

    test('with bot.interrupt_code set it does nothing', async () => {
        const { bot, ctx } = farm();
        bot.interrupt_code = true;
        const res = await harvestCrops(bot, ctx, 'wheat_farm');
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'interrupted');
        assert.equal(digs(bot).length, 0);
    });

    test('nothing ripe: the text of the spec and no walk', async () => {
        const { bot, ctx } = farm({ ages: () => 3 });
        const s = sim(bot);
        const res = await harvestCrops(bot, ctx, 'wheat_farm', { now: s.now, wait: s.wait });
        assert.equal(res.text, 'Nothing is ripe yet. 10 plants are growing.');
        assert.equal(bot.calls.filter(c => c[0] === 'goto').length, 0);
    });

    test('no plants: the text of the spec', async () => {
        const { bot, ctx } = farm({ ages: () => null });
        const res = await harvestCrops(bot, ctx, 'wheat_farm');
        assert.equal(res.text, 'Nothing grows in the farm "wheat_farm". I can plant if I get seeds.');
    });

    test('the limit ends after that many plants', async () => {
        const { world, bot, ctx } = farm();
        const s = sim(bot);
        const res = await harvestCrops(bot, ctx, '', { limit: 3, now: s.now, wait: s.wait });
        assert.equal(res.harvested, 3);
        assert.equal(res.text, 'I harvested 3 wheat and planted 3 again. 7 ripe plants are left.');
        assert.equal(cropsAt(world, 2, 5).filter(c => c[3] === 7).length, 7);
        assert.equal(gateOpen(world, 5), false);
    });

    test('a stop in the middle: the bot ends at once and says so', async () => {
        const { bot, ctx } = farm();
        const base = bot.dig;
        bot.dig = async (block) => {
            await base(block);
            if (digs(bot).length === 2) bot.interrupt_code = true;
        };
        const s = sim(bot);
        const res = await harvestCrops(bot, ctx, '', { now: s.now, wait: s.wait });
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'interrupted');
        assert.equal(res.harvested, 2);
        assert.match(res.text, /^I harvested 2 wheat and planted \d again\. .*I was stopped before the end\.$/);
    });

    test('without seeds at first: the drops of the first plant plant it again; no seed at all leaves the place empty', async () => {
        const { world, bot, ctx } = farm({ w: 1, d: 2, crop: 'carrots' });
        const s = sim(bot);
        const res = await harvestCrops(bot, ctx, '', { now: s.now, wait: s.wait });
        assert.equal(res.text, 'I harvested 2 carrots and planted 2 again.');
        assert.equal(countOf(bot, 'carrot'), 4);
        assert.equal(world.nameAt(0, 64, 0), 'carrots');

        const f2 = farm({ w: 1, d: 2 });
        const dig = f2.bot.dig;
        f2.bot.dig = async (block) => {
            await dig(block);
            for (const i of f2.bot.inventory.list) if (i.name === 'wheat_seeds') i.count = 0;
        };
        const s2 = sim(f2.bot);
        const res2 = await harvestCrops(f2.bot, f2.ctx, '', { now: s2.now, wait: s2.wait });
        assert.equal(res2.text, 'I harvested 2 wheat and planted 0 again. 2 places stay empty, I have no more seeds.');
    });

    test('drops that lie in the field are picked up by walking over them', async () => {
        const { bot, ctx } = farm({ w: 3, d: 3, ages: (x, z) => (x === 0 && z === 0 ? 7 : 1) });
        const item = { id: 500, name: 'item', type: 'object', position: v(2.4, 64, 2.6), velocity: v(0, 0, 0), metadata: {} };
        bot.entities[500] = item;
        const s = sim(bot, () => {
            if (bot.entities[500] && bot.entity.position.distanceTo(item.position) < 1.5) {
                delete bot.entities[500];
                add(bot, 'wheat_seeds', 1);
            }
        });
        await harvestCrops(bot, ctx, '', { now: s.now, wait: s.wait });
        assert.equal(bot.entities[500], undefined);
    });

    test('an unfenced farm is entered without a gate', async () => {
        const { world, bot, ctx } = farm({ gate: false });
        for (const k of [...bot.blocked]) bot.blocked.delete(k);
        for (let z = -1; z <= 5; z++) world.set(2, 64, z, 'air');
        bot.entity.position = v(4.5, 64, 2.5);
        const s = sim(bot);
        const res = await harvestCrops(bot, ctx, '', { now: s.now, wait: s.wait });
        assert.equal(res.harvested, 10);
        assert.equal(bot.calls.filter(c => c[0] === 'activate' && c[2] === 64 && c[3] === 5).length, 0);
    });

    test('the gate goes through ctx.home.passThrough when the context has it', async () => {
        const { world, bot, ctx } = farm({ w: 1, d: 1 });
        const seen = [];
        const { passThrough } = await import('../../src/agent/packs/home/doors.js');
        ctx.home = {
            passThrough(b, door, c, options) {
                seen.push({ door, inside: options?.inside ?? null, allowDig: options?.allowDig });
                return passThrough(b, door, c, options);
            },
        };
        const s = sim(bot);
        await harvestCrops(bot, ctx, '', { now: s.now, wait: s.wait });
        assert.equal(seen.length, 2, 'in and out');
        assert.deepEqual(seen[0].door, { x: 0, y: 64, z: 1, kind: 'gate' });
        assert.ok(seen[0].inside, 'going in names the field as inside');
        assert.equal(seen[1].inside, null);
        assert.ok(seen.every(c => c.allowDig === false), 'never digs to the gate');
        assert.equal(gateOpen(world, 1), false);
    });

    test('a gate the bot cannot open: no harvest and the reason', async () => {
        const { bot, ctx } = farm({ w: 1, d: 1 });
        ctx.home = { passThrough: () => Promise.resolve({ ok: false, reason: 'monster_near', text: 'A monster is near the door at (0, 64, 1). I do not open it.' }) };
        const res = await harvestCrops(bot, ctx, '');
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'monster_near');
        assert.equal(res.text, 'A monster is near the door at (0, 64, 1). I do not open it.');
        assert.equal(digs(bot).length, 0);
    });

    test('with the area guard installed nothing is refused', async () => {
        const { world, bot, area, ctx } = farm({ ages: (x) => (x === 0 ? 7 : 4) });
        const house = { name: 'home', type: 'building', dimension: 'overworld', min: { x: 10, y: 60, z: 10 }, max: { x: 16, y: 70, z: 16 }, entrances: [] };
        const refused = [];
        installAreaGuard(bot, { store: { list: () => [area, house] }, log: (t) => refused.push(t) });
        ctx.areas = [area, house];
        const s = sim(bot);
        const res = await harvestCrops(bot, ctx, '', { now: s.now, wait: s.wait });
        assert.equal(res.text, 'I harvested 5 wheat and planted 5 again. 5 plants are not ripe yet.');
        assert.deepEqual(refused, []);
        assert.equal(gateOpen(world, 5), false);
    });

    test('an error of the world ends in a text, never in a throw', async () => {
        const { bot, ctx } = farm();
        bot.blockAt = () => { throw new Error('world gone'); };
        const res = await harvestCrops(bot, ctx, 'wheat_farm');
        assert.equal(res.ok, true, 'a field that cannot be read has no plants');
        assert.equal(res.text, 'Nothing grows in the farm "wheat_farm". I can plant if I get seeds.');
        const res2 = await harvestCrops({}, null, 'x');
        assert.equal(res2.ok, false);
    });
});

describe('plantField', () => {
    const mixed = (x, z) => (x === 1 && z >= 3 ? 'grass_block' : 'farmland');

    test('plants every free place and tills the grass inside the fence with a hoe', async () => {
        const { world, bot, ctx } = farm({ ground: mixed, ages: () => null });
        give(bot, 'wheat_seeds', 20);
        give(bot, 'stone_hoe', 1);
        const s = sim(bot);
        const res = await plantField(bot, ctx, 'wheat_farm', 'wheat_seeds', { now: s.now, wait: s.wait });
        assert.equal(res.ok, true, res.text);
        assert.equal(res.text, 'I tilled 2 blocks and planted 10 wheat_seeds.', 'v0.1.4.8, E2: the tilled blocks are named');
        assert.equal(res.tilled, 2);
        assert.equal(farmlandCount(world, 2, 5), 10);
        assert.ok(cropsAt(world, 2, 5).every(c => c[2] === 'wheat' && c[3] === 0));
        assert.equal(countOf(bot, 'wheat_seeds'), 10);
        assert.equal(digs(bot).length, 0, 'nothing was dug');
        assert.equal(gateOpen(world, 5), false);
    });

    test('without a hoe only the farmland', async () => {
        const { world, bot, ctx } = farm({ ground: mixed, ages: () => null });
        give(bot, 'wheat_seeds', 20);
        const s = sim(bot);
        const res = await plantField(bot, ctx, '', undefined, { now: s.now, wait: s.wait });
        assert.equal(res.text, `I planted 8 wheat_seeds. ${TEXTS.noHoe}`);
        assert.equal(world.nameAt(1, 63, 4), 'grass_block');
    });

    test('coarse dirt needs the hoe twice', async () => {
        const { world, bot, ctx } = farm({ w: 1, d: 1, ground: () => 'coarse_dirt', ages: () => null });
        give(bot, 'beetroot_seeds', 1);
        give(bot, 'wooden_hoe', 1);
        const s = sim(bot);
        const res = await plantField(bot, ctx, '', 'beetroot', { now: s.now, wait: s.wait });
        assert.equal(res.text, 'I tilled 1 block and planted 1 beetroot_seeds.');
        assert.equal(world.nameAt(0, 63, 0), 'farmland');
        assert.equal(world.nameAt(0, 64, 0), 'beetroots');
    });

    test('too few seeds: the places that stay empty', async () => {
        const { bot, ctx } = farm({ ages: () => null });
        give(bot, 'wheat_seeds', 7);
        const s = sim(bot);
        const res = await plantField(bot, ctx, '', 'seeds', { now: s.now, wait: s.wait });
        assert.equal(res.text, 'I planted 7 wheat_seeds. 3 places stay empty, I have no more seeds.');
        assert.equal(res.ok, true);
    });

    test('no seeds and no chest', async () => {
        const { bot, ctx } = farm({ ages: () => null });
        const res = await plantField(bot, ctx, '', 'carrot');
        assert.equal(res.ok, false);
        assert.equal(res.text, 'I have no carrot and know no chest with them.');
    });

    test('seeds from a chest through ctx.storage.fetchItem(name, count)', async () => {
        const { bot, ctx } = farm({ ages: () => null });
        const calls = [];
        ctx.storage = {
            fetchItem(...args) {
                calls.push(args);
                add(bot, args[0], 6);
                return Promise.resolve({ ok: false, reason: 'partly', taken: 6, text: `I took 6 ${args[0]} from the chest at (5, 64, 9). There was no more.` });
            },
        };
        give(bot, 'wheat_seeds', 2);
        const s = sim(bot);
        const res = await plantField(bot, ctx, '', 'wheat_seeds', { now: s.now, wait: s.wait });
        assert.deepEqual(calls, [['wheat_seeds', 8]]);
        assert.equal(res.text, 'I planted 8 wheat_seeds. 2 places stay empty, I have no more seeds.');
    });

    test('a failing storage is no reason to throw', async () => {
        const { bot, ctx } = farm({ ages: () => null });
        ctx.storage = { fetchItem: () => Promise.reject(new Error('chest gone')) };
        const res = await plantField(bot, ctx, '', 'wheat_seeds');
        assert.equal(res.text, 'I have no wheat_seeds and know no chest with them.');
    });

    test('a field that is planted already, an unknown seed', async () => {
        const { bot, ctx } = farm({ ages: () => 1 });
        give(bot, 'wheat_seeds', 5);
        const res = await plantField(bot, ctx, 'wheat_farm');
        assert.equal(res.text, 'Every place in the farm "wheat_farm" is planted already.');
        const res2 = await plantField(bot, ctx, '', 'melon_seeds');
        assert.equal(res2.ok, false);
        assert.equal(res2.text, 'I cannot plant melon_seeds. I can plant wheat_seeds, carrot, potato and beetroot_seeds.');
    });

    test('a place the bot cannot reach stays empty and is named', async () => {
        const { bot, ctx } = farm({ w: 1, d: 3, ages: () => null });
        give(bot, 'wheat_seeds', 5);
        const base = bot.gotoImpl;
        bot.gotoImpl = (goal) => {
            if (goal.x === 0 && goal.z === 0) {
                // The last cell: the walk fails and leaves the bot out of reach.
                bot.entity.position = v(0.5, 64, 12.5);
                throw Object.assign(new Error('no path'), { name: 'NoPath' });
            }
            return base(goal);
        };
        const s = sim(bot);
        const res = await plantField(bot, ctx, '', 'wheat_seeds', { now: s.now, wait: s.wait });
        assert.equal(res.text, 'I planted 2 wheat_seeds. 1 place stays empty, I could not reach them.');
    });
});

describe('makeBoneMeal', () => {
    function yard() {
        const world = makeWorld();
        const bot = makeFakeBot({ world, pos: [0.5, 64, 0.5] });
        installFarmSim(bot);
        world.set(3, 64, 0, 'composter', { level: 0 });
        return { world, bot };
    }

    test('fills the composter from leaves and keeps every seed', async () => {
        const { world, bot } = yard();
        give(bot, 'oak_leaves', 30);
        give(bot, 'wheat_seeds', 12);
        give(bot, 'beetroot_seeds', 3);
        const s = sim(bot);
        const res = await makeBoneMeal(bot, {}, 2, { now: s.now, wait: s.wait });
        assert.equal(res.ok, true, res.text);
        assert.equal(res.text, 'I made 2 bone_meal from 14 items.');
        assert.equal(countOf(bot, 'bone_meal'), 2);
        assert.equal(countOf(bot, 'wheat_seeds'), 12);
        assert.equal(countOf(bot, 'beetroot_seeds'), 3);
        assert.equal(countOf(bot, 'oak_leaves'), 16);
        assert.equal(world.propsAt(3, 64, 0).level, 0);
    });

    // Found on the real server (integration round of v0.1.4.7): the bone meal pops out of the full
    // composter as an item and can roll off it. The answer said "I made 1 bone_meal" and the bone meal
    // lay on the ground. Here it lands 1.7 blocks beside the composter and is picked up only by a bot
    // that stands within 1.3 blocks of it.
    function rollingBoneMeal(bot, at) {
        bot.onActivate = ((orig) => (block) => {
            const p = block.position;
            if (bot.world.nameAt(p.x, p.y, p.z) === 'composter' && (bot.world.propsAt(p.x, p.y, p.z).level ?? 0) === 8) {
                bot.world.setProps(p.x, p.y, p.z, { level: 0 });
                const e = { id: 9000 + Object.keys(bot.entities).length, name: 'item', type: 'object', isValid: true,
                    position: v(at.x, at.y, at.z), getDroppedItem: () => ({ name: 'bone_meal', count: 1 }) };
                bot.entities[e.id] = e;
                return;
            }
            orig(block);
        })(bot.onActivate);
        return () => {
            const b = bot.entity.position;
            for (const e of Object.values(bot.entities)) {
                if (e.name !== 'item' || Math.hypot(e.position.x - b.x, e.position.z - b.z) > 1.3 || Math.abs(e.position.y - b.y) > 1.5) continue;
                add(bot, e.getDroppedItem().name, 1);
                e.isValid = false;
                delete bot.entities[e.id];
            }
        };
    }

    test('bone meal that rolled off the composter is picked up; the text counts what the bot has', async () => {
        const { bot } = yard();
        give(bot, 'oak_leaves', 20);
        const pickup = rollingBoneMeal(bot, { x: 5.2, y: 64, z: 0.5 });
        const s = sim(bot, pickup);
        const res = await makeBoneMeal(bot, {}, 1, { now: s.now, wait: s.wait });
        assert.equal(countOf(bot, 'bone_meal'), 1);
        assert.equal(res.text, 'I made 1 bone_meal from 7 items.');
        assert.deepEqual(Object.values(bot.entities).filter(e => e.name === 'item'), [], 'nothing lies on the ground');
    });

    test('bone meal that cannot be reached is not counted', async () => {
        const { bot } = yard();
        give(bot, 'oak_leaves', 7);
        const pickup = rollingBoneMeal(bot, { x: 5.2, y: 64, z: 0.5 });
        bot.gotoImpl = async () => { throw Object.assign(new Error('no path'), { name: 'NoPath' }); };
        const s = sim(bot, pickup);
        const t0 = s.now();
        const res = await makeBoneMeal(bot, {}, 1, { now: s.now, wait: s.wait });
        assert.equal(countOf(bot, 'bone_meal'), 0);
        assert.match(res.text, /^I made 0 bone_meal from 7 items\./);
        assert.ok(s.now() - t0 < 60000, `it gave up after ${s.now() - t0} ms`);
    });

    test('a full composter gives its bone meal first', async () => {
        const { world, bot } = yard();
        world.setProps(3, 64, 0, { level: 8 });
        give(bot, 'bone_meal', 1);
        bot.equip(bot.inventory.list[0], 'hand');
        const s = sim(bot);
        const res = await makeBoneMeal(bot, {}, 1, { now: s.now, wait: s.wait });
        assert.equal(res.text, 'I made 1 bone_meal from 0 items.');
        assert.ok(bot.calls.some(c => c[0] === 'unequip'), 'no bone meal in the hand at the composter');
    });

    test('no composter within 32 blocks', async () => {
        const { world, bot } = yard();
        world.set(3, 64, 0, 'air');
        world.set(40, 64, 0, 'composter', { level: 0 });
        const res = await makeBoneMeal(bot, {});
        assert.equal(res.ok, false);
        assert.equal(res.text, TEXTS.noComposter);
    });

    test('only seeds: nothing to compost, the seeds stay', async () => {
        const { bot } = yard();
        give(bot, 'wheat_seeds', 30);
        give(bot, 'wheat', 5);
        const s = sim(bot);
        const res = await makeBoneMeal(bot, {}, 1, { now: s.now, wait: s.wait });
        assert.equal(res.ok, false);
        assert.equal(res.text, TEXTS.nothingToCompost, 'v0.1.4.8, E2: no sentence about shears');
        assert.equal(countOf(bot, 'wheat_seeds'), 30);
    });

    test('with shears and nothing to compost the text does not speak of shears (Amendment 2, I3)', async () => {
        const { bot } = yard();
        give(bot, 'wheat_seeds', 30);
        give(bot, 'shears', 1);
        const s = sim(bot);
        const res = await makeBoneMeal(bot, {}, 1, { now: s.now, wait: s.wait });
        assert.equal(res.text, TEXTS.nothingToCompost);
    });

    test('a hay block is 9 wheat: it never goes into the composter (Amendment 2, I3)', async () => {
        const { world, bot } = yard();
        give(bot, 'hay_block', 5);
        const s = sim(bot);
        const res = await makeBoneMeal(bot, {}, 1, { now: s.now, wait: s.wait });
        assert.equal(countOf(bot, 'hay_block'), 5);
        assert.equal(world.propsAt(3, 64, 0).level, 0);
        assert.equal(res.text, TEXTS.nothingToCompost);
    });

    test('made less than asked with shears: no sentence about shears (Amendment 2, I3)', async () => {
        const { bot } = yard();
        give(bot, 'oak_sapling', 3);
        give(bot, 'shears', 1);
        const s = sim(bot);
        const res = await makeBoneMeal(bot, {}, 1, { now: s.now, wait: s.wait });
        assert.equal(res.text, 'I made 0 bone_meal from 3 items. The composter is at level 3 of 7, I have nothing more to compost.');
    });

    test('picks flowers outside of protected areas; grass and leaves only with shears', async () => {
        const { world, bot } = yard();
        for (let x = -4; x <= 2; x++) world.set(x, 64, 6, 'poppy');
        world.set(20, 64, 20, 'dandelion');
        world.set(0, 64, -5, 'short_grass');
        world.set(1, 66, -5, 'oak_leaves', { persistent: false });
        const garden = { name: 'garden', type: 'farm', dimension: 'overworld', min: { x: 19, y: 60, z: 19 }, max: { x: 21, y: 70, z: 21 } };
        const s = sim(bot);
        const res = await makeBoneMeal(bot, { areas: [garden] }, 1, { now: s.now, wait: s.wait });
        assert.equal(res.text, 'I made 1 bone_meal from 7 items.');
        assert.equal(world.nameAt(20, 64, 20), 'dandelion', 'the flower in the area stays');
        assert.equal(world.nameAt(0, 64, -5), 'short_grass', 'no shears, no grass');
        assert.ok(digs(bot).every(([, , z]) => z === 6));
    });

    test('with shears it cuts grass and natural leaves, never leaves a player placed', async () => {
        const { world, bot } = yard();
        give(bot, 'shears', 1);
        for (let x = -3; x <= 3; x++) world.set(x, 64, -4, 'short_grass');
        world.set(5, 64, 5, 'oak_leaves', { persistent: true });
        const s = sim(bot);
        const res = await makeBoneMeal(bot, {}, 1, { now: s.now, wait: s.wait });
        assert.equal(res.text, 'I made 1 bone_meal from 7 items.');
        assert.equal(world.nameAt(5, 64, 5), 'oak_leaves');
    });

    test('stops after 64 items', async () => {
        const { bot } = yard();
        bot.onActivate = ((orig) => (block) => {
            if (bot.world.nameAt(block.position.x, block.position.y, block.position.z) === 'composter' && bot.heldItem) {
                bot.heldItem.count--;
                return;
            }
            orig(block);
        })(bot.onActivate);
        give(bot, 'oak_leaves', 64);
        give(bot, 'short_grass', 10);
        const s = sim(bot);
        const res = await makeBoneMeal(bot, {}, 1, { now: s.now, wait: s.wait });
        assert.equal(res.text, 'I made 0 bone_meal from 64 items. I stop after 64 items.');
        assert.equal(countOf(bot, 'short_grass') + countOf(bot, 'oak_leaves'), 10);
    });

    test('runs out of items part way', async () => {
        const { world, bot } = yard();
        give(bot, 'oak_sapling', 3);
        const s = sim(bot);
        const res = await makeBoneMeal(bot, {}, 1, { now: s.now, wait: s.wait });
        assert.equal(res.text, 'I made 0 bone_meal from 3 items. The composter is at level 3 of 7, I have nothing more to compost.',
            'v0.1.4.8, E2: no sentence about shears');
        assert.equal(world.propsAt(3, 64, 0).level, 3);
    });
});

describe('fertilize', () => {
    test('uses bone meal until the plants are ripe', async () => {
        const ages = (x, z) => [0, 2, 5, 7, 7][z] ?? 7;
        const { world, bot, ctx } = farm({ w: 1, d: 5, ages });
        give(bot, 'bone_meal', 10);
        const s = sim(bot);
        const res = await fertilize(bot, ctx, '', { now: s.now, wait: s.wait });
        assert.equal(res.ok, true, res.text);
        assert.equal(res.text, 'I used 6 bone_meal. 5 plants are ripe now.');
        assert.equal(countOf(bot, 'bone_meal'), 4);
        assert.ok(cropsAt(world, 1, 5).every(c => c[3] === 7));
        assert.equal(gateOpen(world, 5), false);
    });

    test('bone meal runs out', async () => {
        const { bot, ctx } = farm({ w: 1, d: 3, ages: () => 0 });
        give(bot, 'bone_meal', 2);
        const s = sim(bot);
        const res = await fertilize(bot, ctx, '', { now: s.now, wait: s.wait });
        assert.equal(res.text, 'I used 2 bone_meal. No plant is ripe yet.');
    });

    test('no bone meal; nothing to fertilize', async () => {
        const { bot, ctx } = farm();
        assert.equal((await fertilize(bot, ctx, '')).text, TEXTS.noBoneMeal);
        give(bot, 'bone_meal', 3);
        assert.equal((await fertilize(bot, ctx, '')).text, 'No plant needs bone_meal. 10 plants are ripe.');
    });
});

describe('farmCycle', () => {
    test('harvest, store, plant and the gate, in one text', async () => {
        const ages = (x, z) => (z < 3 ? 7 : (x === 0 && z === 4 ? null : 1));
        const { world, bot, ctx } = farm({ ages });
        const stored = [];
        ctx.storage = {
            storeItems(options) {
                stored.push(options);
                for (const i of bot.inventory.list) if (i.name === 'wheat') i.count = 0;
                return Promise.resolve({ ok: true, stored: [{ name: 'wheat', count: 6 }], text: 'I stored 6 wheat in the chest at (-13, 63, 28).' });
            },
        };
        const s = sim(bot);
        const res = await farmCycle(bot, ctx, '', { now: s.now, wait: s.wait, fertilize: false });
        assert.equal(res.ok, true, res.text);
        assert.equal(res.text, 'Farm "wheat_farm": I harvested 6 wheat and planted 6 again. 3 plants are not ripe yet. '
            + 'I stored 6 wheat in the chest at (-13, 63, 28). I planted 1 wheat_seeds. The gate is closed.');
        // F23 (v0.1.4.11): 32 seeds and one for the empty cell the planting sows after the store step
        assert.deepEqual(stored, [{ only: ['wheat', 'wheat_seeds'], keep: { wheat_seeds: 33 } }]);
        assert.equal(world.nameAt(0, 64, 4), 'wheat');
        assert.equal(gateOpen(world, 5), false);
        assert.ok(bot.entity.position.z > 5);
    });

    test('carrots: the harvest is the seed, 32 of it stay with the bot (Amendment 1)', async () => {
        const { bot, ctx } = farm({ w: 1, d: 2, crop: 'carrots' });
        const stored = [];
        ctx.storage = {
            storeItems(options) {
                stored.push(options);
                return Promise.resolve({ ok: true, reason: null, stored: [], left: [], chests: [], text: 'I stored 4 carrot in the chest at (1, 2, 3).' });
            },
        };
        const s = sim(bot);
        const res = await farmCycle(bot, ctx, '', { now: s.now, wait: s.wait, fertilize: false });
        assert.deepEqual(stored, [{ only: ['carrot'], keep: { carrot: 32 } }]);
        assert.equal(res.text, 'Farm "wheat_farm": I harvested 2 carrots and planted 2 again. I stored 4 carrot in the chest at (1, 2, 3). The gate is closed.');
    });

    test('without storage it skips the chest and uses bone meal when it has some', async () => {
        const { bot, ctx } = farm({ w: 1, d: 2, ages: (x, z) => (z === 0 ? 7 : 4) });
        give(bot, 'bone_meal', 5);
        const s = sim(bot);
        const res = await farmCycle(bot, ctx, 'wheat_farm', { now: s.now, wait: s.wait });
        // v0.1.4.8, E2: the plants that got ripe are harvested in the same cycle
        assert.equal(res.text, 'Farm "wheat_farm": I harvested 1 wheat and planted 1 again. 2 plants are not ripe. '
            + 'I used 4 bone_meal. 2 more plants got ripe and I harvested them. The gate is closed.');
    });

    test('an empty field is planted; nothing to say about the harvest then', async () => {
        const { bot, ctx } = farm({ w: 1, d: 2, ages: () => null });
        give(bot, 'wheat_seeds', 5);
        const s = sim(bot);
        const res = await farmCycle(bot, ctx, '', { now: s.now, wait: s.wait, fertilize: false });
        assert.equal(res.text, 'Farm "wheat_farm": I planted 2 wheat_seeds. The gate is closed.');
    });

    test('a gate left open by someone is closed; a player in it is left alone', async () => {
        const { world, bot, ctx } = farm({ ages: () => 3 });
        world.setProps(0, 64, 5, { open: true });
        const s = sim(bot);
        const res = await farmCycle(bot, ctx, '', { now: s.now, wait: s.wait, fertilize: false });
        assert.equal(res.text, 'Farm "wheat_farm": Nothing is ripe yet. 10 plants are growing. The gate is closed.');
        assert.equal(gateOpen(world, 5), false);

        const f2 = farm({ ages: () => 3 });
        f2.world.setProps(0, 64, 5, { open: true });
        addPlayer(f2.bot, 'owner', [0.5, 64, 5.5]);
        const s2 = sim(f2.bot);
        const res2 = await farmCycle(f2.bot, f2.ctx, '', { now: s2.now, wait: s2.wait, fertilize: false });
        assert.equal(res2.text, 'Farm "wheat_farm": Nothing is ripe yet. 10 plants are growing. The gate at (0, 64, 5) is open.');
    });

    test('no farm', async () => {
        const bot = makeFakeBot({ pos: [50.5, 64, 50.5] });
        const res = await farmCycle(bot, {}, '');
        assert.equal(res.ok, false);
        assert.equal(res.text, TEXTS.noFarm);
    });
});

describe('fieldMovements and limits', () => {
    test('movements for the field: no sprint, no parkour, no digging, no placing, no big drop', () => {
        const { bot } = farm();
        const cells = [{ x: 0, y: 63, z: 0, ground: 'farmland', above: 'air', age: null }];
        const m = fieldMovements(bot, cells);
        assert.equal(m.allowSprinting, false);
        assert.equal(m.allowParkour, false);
        assert.equal(m.canDig, false);
        assert.equal(m.canOpenDoors, false);
        assert.ok(m.maxDropDown <= 3);
        assert.ok(m.exclusionAreasStep.some(fn => fn({ position: v(0, 66, 0) }) === 100));
        assert.ok(FARM_LIMITS.maxMs >= 60000);
    });
});
