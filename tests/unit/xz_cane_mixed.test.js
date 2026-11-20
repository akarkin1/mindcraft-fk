// FX1, review of v0.1.4.16, finding 3 (the lead's decision): one sugar cane in a farm's box made the whole farm a cane area,
// and a cane area has no field cells, so !harvest, !farmCycle and !plant cut cane and never touched the crops again. An area is
// a cane area only when it is marked so (its name is `cane` or `cane_N`, or its detail says cane) or it has no farmland at all;
// a farm with crops and some cane is a crop farm and works as in v0.1.4.15; the cane is cut only when the order names it:
// !harvest("sugar_cane") takes the nearest cane area, else the cane columns of the farm that has them (its crops untouched,
// its field still guarded against jumps). The field is the review's (cane.mjs of review-16): 9 x 9 wheat on farmland at y 63,
// water in the middle, one cane on a dirt block beside the water.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { give, makeFakeBot, makeSim, makeWorld, v } from './home_fake_bot.test.js';
import { farmCycle, findFarm, harvestCrops, plantField } from '../../src/agent/packs/farming/farming.js';
import { caneColumns, isCaneArea } from '../../src/agent/packs/farming/field_logic.js';

const SIDE = 9;
const WATER = [4, 4];
const CANE = [4, 3];
const FIELD_CELLS = SIDE * SIDE - 2; // the water and the cane's dirt are no farmland

function countOf(bot, name) {
    return bot.inventory.list.filter(i => i.name === name).reduce((s, i) => s + i.count, 0);
}

function add(bot, name, n) {
    const it = bot.inventory.list.find(i => i.name === name);
    if (it) it.count += n;
    else give(bot, name, n);
}

const at = (x, z, [ax, az]) => x === ax && z === az;

// The review's field: farmland at y 63 (water at the middle, dirt under the cane), wheat of `age` at y 64 (null: none), the cane
// `caneHeight` blocks tall at (4, 64, 3). The game's rules the pack relies on: ripe wheat drops wheat and seeds, unripe a seed;
// a cut cane drops itself and every cane above it; seeds on farmland with air above grow wheat of age 0.
function wheatField({ age = 7, caneHeight = 2, name = 'wheat_farm', extraAreas = [] } = {}) {
    const world = makeWorld();
    for (let x = 0; x < SIDE; x++) {
        for (let z = 0; z < SIDE; z++) {
            if (at(x, z, WATER)) world.set(x, 63, z, 'water');
            else if (at(x, z, CANE)) world.set(x, 63, z, 'dirt');
            else {
                world.set(x, 63, z, 'farmland', { moisture: 7 });
                if (age !== null) world.set(x, 64, z, 'wheat', { age });
            }
        }
    }
    for (let y = 64; y < 64 + caneHeight; y++) world.set(CANE[0], y, CANE[1], 'sugar_cane', { age: 0 });
    const bot = makeFakeBot({ world, pos: [4.5, 64, SIDE + 3.5] });
    bot.unequip = async () => { bot.heldItem = null; };
    bot.onActivate = (block) => {
        const p = block.position;
        const held = bot.heldItem && bot.heldItem.count > 0 ? bot.heldItem : null;
        if (held?.name === 'wheat_seeds' && world.nameAt(p.x, p.y, p.z) === 'farmland' && world.nameAt(p.x, p.y + 1, p.z) === 'air') {
            world.set(p.x, p.y + 1, p.z, 'wheat', { age: 0 });
            held.count--;
        }
    };
    const baseDig = bot.dig;
    bot.dig = async (block) => {
        const p = block.position;
        const was = world.nameAt(p.x, p.y, p.z);
        const props = world.propsAt(p.x, p.y, p.z);
        await baseDig(block);
        if (was === 'wheat') {
            if ((props.age ?? 0) >= 7) { add(bot, 'wheat', 1); add(bot, 'wheat_seeds', 2); } else add(bot, 'wheat_seeds', 1);
        } else if (was === 'sugar_cane') {
            let n = 1;
            for (let y = p.y + 1; world.nameAt(p.x, y, p.z) === 'sugar_cane'; y++) {
                world.set(p.x, y, p.z, 'air');
                n++;
            }
            add(bot, 'sugar_cane', n);
        }
    };
    // the review's box: one layer at the crops' height (the farmland under it)
    const area = { name, type: 'farm', kind: 'farm', border: 'open', dimension: 'overworld', source: 'survey', entrances: [],
        min: { x: 0, y: 64, z: 0 }, max: { x: SIDE - 1, y: 64, z: SIDE - 1 } };
    return { world, bot, area, ctx: { areas: [area, ...extraAreas] } };
}

const reader = (world) => (x, y, z) => ({ name: world.nameAt(x, y, z) });
const wheatDigs = (bot, world) => bot.calls.filter(c => c[0] === 'dig' && c[2] === 64 && !(c[1] === CANE[0] && c[3] === CANE[1])).length;
const caneLeft = (world) => {
    let n = 0;
    for (let y = 64; world.nameAt(CANE[0], y, CANE[1]) === 'sugar_cane'; y++) n++;
    return n;
};

describe('isCaneArea and findFarm on a wheat farm with one cane', () => {
    test('the review\'s field is a crop farm; a marked area or one without farmland is a cane area', () => {
        const { world, area, bot, ctx } = wheatField({ caneHeight: 1 });
        const get = reader(world);
        assert.deepEqual(caneColumns(get, area), [{ x: 4, y: 64, z: 3, height: 1 }], 'the cane is seen');
        assert.equal(isCaneArea(get, area), false, 'a 9 x 9 wheat field with one cane is no cane area');
        assert.equal(isCaneArea(get, { ...area, name: 'cane' }), true, 'by the survey\'s name');
        assert.equal(isCaneArea(get, { ...area, name: 'Cane_3' }), true);
        assert.equal(isCaneArea(get, { ...area, detail: { what: 'cane' } }), true, 'by the survey\'s detail, where the store keeps it');
        assert.equal(isCaneArea(get, { ...area, name: 'cane_farm' }), false, 'a name that only begins with cane is no mark');
        const bare = { name: 'reeds', type: 'farm', min: { x: 4, y: 64, z: 3 }, max: { x: 4, y: 64, z: 3 } };
        assert.equal(isCaneArea(get, bare), true, 'cane and no farmland in the box');
        assert.equal(isCaneArea(get, { ...bare, min: { x: 20, y: 64, z: 20 }, max: { x: 22, y: 64, z: 22 } }), false, 'no cane, no farmland');
        assert.equal(findFarm(bot, ctx, '').farm.cane, false);
        assert.equal(findFarm(bot, ctx, 'wheat_farm').farm.cane, false);
    });

    test('"sugar_cane" names a cane area first, even a farther one; failing that the cane of the farm that has it', () => {
        const { bot, ctx, area } = wheatField();
        const cut = findFarm(bot, ctx, 'sugar_cane');
        assert.equal(cut.ok, true, cut.text);
        assert.equal(cut.farm.name, 'wheat_farm');
        assert.equal(cut.farm.cane, true, 'the order cuts the cane');
        assert.equal(cut.farm.crops, true, 'in a field of crops');
        const far = { name: 'cane', type: 'farm', kind: 'farm', border: 'open', dimension: 'overworld', source: 'survey', entrances: [],
            min: { x: 40, y: 62, z: 0 }, max: { x: 44, y: 66, z: 2 } };
        const both = findFarm(bot, { areas: [area, far] }, 'sugar_cane');
        assert.equal(both.farm.name, 'cane', 'the survey\'s cane area, though the wheat farm is nearer');
        assert.notEqual(both.farm.crops, true);
        const none = wheatField({ caneHeight: 0 });
        assert.equal(findFarm(none.bot, none.ctx, 'sugar_cane').text, 'I know no farm "sugar_cane". I know the farms "wheat_farm".', 'no cane anywhere: as before');
    });
});

describe('the crop farm with one cane works its crops as in v0.1.4.15', () => {
    test('!harvest: every ripe wheat is harvested and planted again; the cane stands', async () => {
        const { world, bot, ctx } = wheatField();
        const s = makeSim(bot);
        const res = await harvestCrops(bot, ctx, '', { now: s.now, wait: s.wait });
        assert.equal(res.ok, true, res.text);
        assert.equal(res.text, `I harvested ${FIELD_CELLS} wheat and planted ${FIELD_CELLS} again.`);
        assert.equal(res.harvested, FIELD_CELLS);
        assert.equal(res.replanted, FIELD_CELLS);
        assert.equal(caneLeft(world), 2, 'the cane is not cut');
        assert.equal(countOf(bot, 'sugar_cane'), 0);
        const named = wheatField();
        const s2 = makeSim(named.bot);
        assert.equal((await harvestCrops(named.bot, named.ctx, 'wheat_farm', { now: s2.now, wait: s2.wait })).text, res.text, 'by its name too');
    });

    test('!plant: every free farmland cell is planted', async () => {
        const { world, bot, ctx } = wheatField({ age: null });
        give(bot, 'wheat_seeds', 64);
        give(bot, 'wheat_seeds', 64);
        const s = makeSim(bot);
        const res = await plantField(bot, ctx, '', 'wheat_seeds', { now: s.now, wait: s.wait });
        assert.equal(res.ok, true, res.text);
        assert.equal(res.planted, FIELD_CELLS, res.text);
        assert.equal(caneLeft(world), 2);
    });

    test('!farmCycle: the crop round (the harvest first), not the cane', async () => {
        const { world, bot, ctx } = wheatField();
        const s = makeSim(bot);
        const res = await farmCycle(bot, ctx, 'wheat_farm', { fertilize: false, now: s.now, wait: s.wait });
        assert.ok(res.text.startsWith(`Farm "wheat_farm": I harvested ${FIELD_CELLS} wheat and planted ${FIELD_CELLS} again.`), res.text);
        assert.equal(res.harvested, FIELD_CELLS);
        assert.equal(caneLeft(world), 2);
    });
});

describe('!harvest("sugar_cane") on the crop farm cuts its cane only', () => {
    test('the cane above the bottom block is cut and picked up; no wheat is dug; the field is guarded against jumps', async () => {
        const { world, bot, ctx } = wheatField({ caneHeight: 3 });
        const steps = [];
        const base = bot.gotoImpl;
        bot.gotoImpl = (goal) => {
            steps.push(bot.pathfinder.movements);
            return base(goal);
        };
        const s = makeSim(bot);
        const res = await harvestCrops(bot, ctx, 'sugar_cane', { now: s.now, wait: s.wait });
        assert.equal(res.ok, true, res.text);
        assert.equal(res.text, 'I cut 2 sugar cane at "wheat_farm" and picked them up.');
        assert.deepEqual(res.byCrop, { sugar_cane: 2 });
        assert.equal(caneLeft(world), 1, 'the bottom cane stands');
        assert.equal(countOf(bot, 'sugar_cane'), 2);
        assert.equal(wheatDigs(bot, world), 0, 'the wheat is not touched');
        assert.ok(steps.length > 0);
        assert.ok(steps.some(m => m?.exclusionAreasStep?.some(fn => fn({ position: v(1, 66, 1) }) >= 100)), 'no jump onto the farmland');
    });
});
