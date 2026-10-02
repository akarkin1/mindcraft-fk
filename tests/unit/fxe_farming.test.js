// Fix round of v0.1.4.8, part E (farming pack). X1: in the long run of the world tests the bot got into the
// composter of the farm and never came out; the walk that picked up the bone meal went to a goal near the item
// on the rim of the composter without the step penalty of the field, and the path search ended on top of the
// composter (a hollow block: the bot falls in and gets out only with a jump). X2: farmland beside the
// composter became dirt (a jump over the composter). X14: the texts count what the inventory gained, and the
// items left near the places of the work are picked up at the end.
//
// Three kinds of tests: the pure logic of field_logic.js; the real path search of mineflayer-pathfinder (A*)
// over a farm of real prismarine blocks, with the movements of the pack; the skills of farming.js on the fake
// bot of the home pack.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { give, makeFakeBot, makeSim, makeWorld, v } from './home_fake_bot.test.js';
import { loadSrc } from '../helpers/load.js';
import { isPassingThrough } from '../../src/agent/packs/home/doors.js';

const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
const REGISTRY = require('prismarine-registry')('1.21.8');
const Block = require('prismarine-block')(REGISTRY);
const AStar = require('mineflayer-pathfinder/lib/astar.js');
const Move = require('mineflayer-pathfinder/lib/move.js');
const { goals } = require('mineflayer-pathfinder');

const F = await loadSrc('src/agent/packs/farming/farming.js');
const G = await loadSrc('src/agent/packs/farming/field_logic.js');
const T = await loadSrc('src/agent/packs/farming/texts.js');
const P = await loadSrc('src/agent/packs/farming/index.js');
const M = await loadSrc('src/agent/packs/home/motion.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

const key = (x, y, z) => `${x},${y},${z}`;

// ---- a farm like the one of the test base (tests/world/base_world.js), as a map of block names ----
// Field x 0..6, z 0..6 (farmland at y 60, wheat at 61), water at (3, 60, 3), the composter at (5, 61, 0) on
// dirt, the oak fence at y 61 around it (x -1..7, z -1..7), a closed gate at (3, 61, -1), the ground outside
// grass at y 60. North of the composter stands the fence, as in the base.
const C = { x: 5, y: 61, z: 0 };
function baseFarm({ age = 3 } = {}) {
    const map = new Map();
    const set = (x, y, z, name, props = {}) => map.set(key(x, y, z), { name, props });
    for (let x = 0; x <= 6; x++) {
        for (let z = 0; z <= 6; z++) {
            set(x, 60, z, 'farmland', { moisture: 7 });
            set(x, 61, z, 'wheat', { age });
        }
    }
    set(3, 60, 3, 'water', { level: 0 });
    set(3, 61, 3, 'air');
    set(C.x, 60, C.z, 'dirt');
    set(C.x, C.y, C.z, 'composter', { level: 0 });
    for (let x = -1; x <= 7; x++) {
        for (let z = -1; z <= 7; z++) {
            if (x === -1 || x === 7 || z === -1 || z === 7) set(x, 61, z, 'oak_fence');
        }
    }
    set(3, 61, -1, 'oak_fence_gate', { facing: 'south', in_wall: false, open: false, powered: false });
    const at = (x, y, z) => map.get(key(x, y, z)) ?? { name: y < 60 ? 'dirt' : y === 60 ? 'grass_block' : 'air', props: {} };
    return {
        map, set,
        get: (x, y, z) => { const b = at(x, y, z); return { name: b.name, properties: b.props }; },
        block(pos) {
            const b = at(pos.x, pos.y, pos.z);
            const block = Block.fromProperties(b.name, b.props, 0);
            block.position = new Vec3(pos.x, pos.y, pos.z);
            return block;
        },
    };
}

// A bot that the Movements of mineflayer-pathfinder can plan with: real blocks, no entities.
function pathBot(world) {
    return {
        registry: REGISTRY,
        entity: { position: new Vec3(4.5, 61, 0.5), isInLava: false, effects: [] },
        game: { minY: -64 },
        inventory: { items: () => [] },
        pathfinder: { bestHarvestTool: () => null },
        blockAt: (pos) => world.block({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) }),
    };
}

function search(movements, goal, from) {
    const astar = new AStar(new Move(from.x, from.y, from.z, 0, 0), movements, goal, 5000, 5000, -1);
    let result = astar.compute();
    while (result.status === 'partial') result = astar.compute();
    return result;
}

const inOrOn = (p, b) => p.x === b.x && p.z === b.z && (p.y === b.y || p.y === b.y + 1);

describe('X1 the logic: where the bot never stands (pure)', () => {
    test('isNoStandBlock: composter, cauldrons, hopper, chests, fences, walls and closed gates', () => {
        for (const name of ['composter', 'minecraft:composter', 'cauldron', 'water_cauldron', 'hopper', 'chest', 'trapped_chest', 'ender_chest',
            'oak_fence', 'nether_brick_fence', 'cobblestone_wall']) {
            assert.equal(G.isNoStandBlock(name), true, name);
        }
        assert.equal(G.isNoStandBlock('oak_fence_gate', { open: false }), true);
        assert.equal(G.isNoStandBlock('oak_fence_gate', null), true, 'a gate of unknown state counts as closed');
        assert.equal(G.isNoStandBlock('oak_fence_gate', { open: true }), false, 'an open gate is walked through');
        for (const name of ['air', 'farmland', 'wheat', 'dirt', 'grass_block', 'water', 'wall_torch', 'barrel', '', null]) {
            assert.equal(G.isNoStandBlock(name), false, String(name));
        }
    });

    test('isNoStandCell: in the composter and on it, never beside it', () => {
        const w = baseFarm();
        assert.equal(G.isNoStandCell(w.get, C), true, 'in it');
        assert.equal(G.isNoStandCell(w.get, { x: C.x, y: C.y + 1, z: C.z }), true, 'on it');
        assert.equal(G.isNoStandCell(w.get, { x: 5.5, y: 61.125, z: 0.5 }), true, 'the position of the long run: inside it');
        assert.equal(G.isNoStandCell(w.get, { x: 4, y: 61, z: 0 }), false, 'beside it, on farmland');
        assert.equal(G.isNoStandCell(w.get, { x: 3, y: 61, z: -1 }), true, 'the closed gate');
        assert.equal(G.isNoStandCell(w.get, { x: 0, y: 62, z: -1 }), true, 'on the fence');
        assert.equal(G.isNoStandCell(() => { throw new Error('gone'); }, C), false, 'never throws');
    });

    test('noStandBlocks and noStandPenalty: the cell of each block and the cell above it cost 100', () => {
        const w = baseFarm();
        const blocks = G.noStandBlocks(w.get, { min: { x: -1, y: 59, z: -1 }, max: { x: 7, y: 63, z: 7 } });
        assert.ok(blocks.some(b => b.x === C.x && b.y === C.y && b.z === C.z && b.name === 'composter'));
        assert.equal(blocks.filter(b => b.name === 'oak_fence').length, 31);
        assert.equal(blocks.filter(b => b.name === 'oak_fence_gate').length, 1);
        const penalty = G.noStandPenalty([C]);
        assert.equal(penalty({ position: v(5, 61, 0) }), 100);
        assert.equal(penalty(v(5, 62, 0)), 100);
        assert.equal(penalty(v(5, 63, 0)), 0);
        assert.equal(penalty(v(4, 61, 0)), 0);
        assert.equal(penalty(null), 0);
    });

    test('standSpots: the free blocks beside the composter, never the composter or the fence; the nearest first', () => {
        const w = baseFarm();
        const spots = G.standSpots(w.get, C, { x: 3.5, y: 61, z: 0.5 });
        assert.deepEqual(spots[0], { x: 4, y: 61, z: 0, side: true }, 'the free side nearest the bot first');
        assert.deepEqual(spots.filter(p => p.side).map(p => [p.x, p.y, p.z]).sort(), [[4, 61, 0], [5, 61, 1], [6, 61, 0]], 'the three free sides');
        assert.deepEqual(spots.filter(p => !p.side).map(p => [p.x, p.z]).sort(), [[4, 1], [6, 1]], 'the corners in the field');
        assert.ok(spots.every(p => !inOrOn(p, C)), 'never in or on the composter');
        assert.ok(spots.every(p => !G.isNoStandCell(w.get, p)), 'never on the fence');
        assert.ok(spots.every(p => Math.abs(p.x - C.x) <= 1 && Math.abs(p.z - C.z) <= 1), 'right beside it');
        assert.deepEqual(G.standSpots(w.get, C, { x: 6.9, y: 61, z: 0.2 })[0], { x: 6, y: 61, z: 0, side: true }, 'nearest to an item on the east rim');
        w.set(4, 61, 0, 'chest', { facing: 'north', type: 'single' });
        assert.ok(!G.standSpots(w.get, C, null).some(p => p.x === 4 && p.z === 0), 'a chest is no place to stand');
        w.set(3, 60, 0, 'water', { level: 0 });
        assert.ok(!G.standSpots(w.get, { x: 3, y: 61, z: 1 }, null).some(p => p.x === 3 && p.z === 0), 'water is no ground');
        assert.deepEqual(G.standSpots(null, C), []);
    });

    test('itemPlace: a bone meal in the composter or on its rim is fetched from beside it; one on farmland from its block', () => {
        const w = baseFarm();
        assert.deepEqual(G.itemPlace(w.get, { x: 5.5, y: 61.125, z: 0.4 }), { beside: C }, 'inside');
        assert.deepEqual(G.itemPlace(w.get, { x: 5.1, y: 62.0, z: 0.5 }), { beside: C }, 'on the rim');
        assert.deepEqual(G.itemPlace(w.get, { x: 4.3, y: 60.9375, z: 0.6 }), { at: { x: 4, y: 61, z: 0 } }, 'on farmland beside it');
        assert.deepEqual(G.itemPlace(w.get, { x: 0.5, y: 62.5, z: -0.5 }), { beside: { x: 0, y: 61, z: -1 } }, 'on a fence post');
        assert.equal(G.itemPlace(w.get, null), null);
    });

    test('goalAvoiding: the goal never ends in or on the composter; x, y, z and the heuristic stay', () => {
        const w = baseFarm();
        const near = new goals.GoalNear(5, 62, 0, 1);
        const safe = G.goalAvoiding(near, node => G.isNoStandCell(w.get, node));
        assert.equal(near.isEnd(v(5, 62, 0)), true);
        assert.equal(safe.isEnd(v(5, 62, 0)), false, 'on the composter');
        assert.equal(safe.isEnd(v(5, 61, 0)), false, 'in the composter');
        assert.equal(safe.isEnd(v(5, 61, 1)), false, 'too far for GoalNear');
        assert.equal(G.goalAvoiding(new goals.GoalNear(5, 61, 0, 1), node => G.isNoStandCell(w.get, node)).isEnd(v(5, 61, 1)), true, 'beside it');
        assert.deepEqual([safe.x, safe.y, safe.z, safe.rangeSq], [5, 62, 0, 1]);
        assert.equal(safe.heuristic(v(0, 61, 0)), near.heuristic(v(0, 61, 0)));
        assert.equal(safe.hasChanged(), false);
        assert.equal(safe.isValid(), true);
        assert.equal(G.goalAvoiding(near, () => { throw new Error('x'); }).isEnd(v(5, 62, 0)), true, 'a failing test refuses nothing');
    });

    test('index.js exports the new names', () => {
        for (const name of ['isNoStandBlock', 'isNoStandCell', 'noStandBlocks', 'noStandPenalty', 'standSpots', 'itemPlace', 'goalAvoiding', 'lostCropText']) {
            assert.equal(typeof P[name], 'function', name);
        }
    });
});

describe('X1, X2 the path search of mineflayer-pathfinder over the farm of the base', () => {
    test('the cause of v0.1.4.8, gone in v0.1.4.10 (P4): the plain path search no longer ends on top of the composter', () => {
        const w = baseFarm();
        const bot = pathBot(w);
        // the plain path search: since v0.1.4.10 the patch itself marks the composter as no standing place
        const old = new (require('mineflayer-pathfinder').Movements)(bot);
        old.canDig = false;
        const res = search(old, new goals.GoalNear(5, 62, 0, 1), { x: 4, y: 61, z: 0 });
        // no cell within 1 block of the top of the composter is a standing place: no path, or a path that ends elsewhere
        const end = res.path[res.path.length - 1] ?? null;
        assert.ok(res.status !== 'success' || JSON.stringify([end.x, end.y, end.z]) !== JSON.stringify([5, 62, 0]), 'not on top of the hollow composter');
    });

    test('with the movements of the field and the safe goal the path search never goes into or onto the composter', () => {
        const w = baseFarm();
        const bot = pathBot(w);
        const cells = G.fieldCells(w.get, { min: { x: -1, y: 59, z: -1 }, max: { x: 7, y: 63, z: 7 } });
        const avoid = G.noStandBlocks(w.get, { min: { x: -2, y: 58, z: -2 }, max: { x: 8, y: 66, z: 8 } });
        const m = F.fieldMovements(bot, cells, avoid);
        assert.ok(m.fences.has(REGISTRY.blocksByName.composter.id), 'the composter is no block to stand on');
        assert.ok(m.fences.has(REGISTRY.blocksByName.chest.id), 'nor is a chest');
        assert.ok(m.exclusionAreasStep.some(fn => fn({ position: v(5, 62, 0) }) === 100), 'the cell above the composter');
        const safe = (goal) => G.goalAvoiding(goal, node => G.isNoStandCell(w.get, node));
        const rim = search(m, safe(new goals.GoalNear(5, 62, 0, 1)), { x: 4, y: 61, z: 0 });
        assert.notEqual(rim.status, 'success', 'no place within 1 block of the rim is a place to stand');
        assert.ok(rim.path.every(p => !inOrOn(p, C)), JSON.stringify(rim.path));
        const near = search(m, safe(new goals.GoalNear(5, 61, 0, 2)), { x: 1, y: 61, z: 0 });
        assert.equal(near.status, 'success');
        assert.ok(near.path.every(p => !inOrOn(p, C)));
        const end = near.path[near.path.length - 1];
        assert.equal(end.y, 61, 'on the farmland beside it');
        const across = search(m, safe(new goals.GoalBlock(6, 61, 0)), { x: 4, y: 61, z: 0 });
        assert.equal(across.status, 'success');
        assert.ok(across.path.every(p => !inOrOn(p, C) && p.y === 61), `around the composter, never over it: ${JSON.stringify(across.path)}`);
    });

    test('X2: no diagonal step past the corner of the composter or a fence post (the bot would jump round it onto farmland)', () => {
        const w = baseFarm();
        const bot = pathBot(w);
        const m = F.fieldMovements(bot, [], []);
        const next = (x, y, z) => m.getNeighbors(new Move(x, y, z, 0, 0)).map(n => key(n.x, n.y, n.z));
        assert.ok(!next(4, 61, 0).includes(key(5, 61, 1)), 'past the corner of the composter');
        assert.ok(next(4, 61, 0).includes(key(4, 61, 1)), 'the straight step beside it');
        assert.ok(!next(0, 61, 0).includes(key(1, 61, -1)), 'no step into the fence line');
        assert.ok(next(1, 61, 2).includes(key(2, 61, 3)), 'a diagonal step in the open field');
        const old = M.makeMovements(bot, { dig: false });
        assert.ok(old.getNeighbors(new Move(4, 61, 0, 0, 0)).some(n => n.x === 5 && n.z === 1), 'the movements of the home pack take it');
    });

    test('even without the list of blocks to avoid, the movements of the pack never stand on a composter or a chest', () => {
        const w = baseFarm();
        w.set(1, 61, 3, 'chest', { facing: 'north', type: 'single' });
        const bot = pathBot(w);
        const m = F.fieldMovements(bot, [], []);
        const top = search(m, new goals.GoalBlock(5, 62, 0), { x: 4, y: 61, z: 0 });
        assert.notEqual(top.status, 'success');
        const chest = search(m, new goals.GoalBlock(1, 62, 3), { x: 0, y: 61, z: 3 });
        assert.notEqual(chest.status, 'success');
    });
});

// ---- the skills on the fake bot ----

function add(bot, name, n = 1) {
    const it = bot.inventory.list.find(i => i.name === name);
    if (it) it.count += n;
    else give(bot, name, n);
}

const countOf = (bot, name) => bot.inventory.list.filter(i => i.name === name).reduce((s, i) => s + i.count, 0);

let nextId = 5000;
function dropItem(bot, name, pos, { stuck = false } = {}) {
    const e = { id: nextId++, name: 'item', type: 'object', isValid: true, position: v(pos.x, pos.y, pos.z), stuck,
        getDroppedItem: () => ({ name, count: 1 }), metadata: {} };
    bot.entities[e.id] = e;
    return e;
}

// The base farm on the fake world (grass at y 63): field x 0..6, z 0..6 at y 63, wheat at 64, the composter
// at (5, 64, 0) with the fence north of it, the gate at (3, 64, -1). A full composter gives a bone meal that
// lands on its rim (as on the server about half of the time). Items are picked up by a bot within 1.3 blocks
// (x, z) and 1.5 (y), as the pick-up box of the game; `stuck` items never.
function fakeFarm({ ages = () => 5, level = 0, pos = [3.5, 64, -3.5] } = {}) {
    const world = makeWorld();
    const c = { x: 5, y: 64, z: 0 };
    for (let x = 0; x <= 6; x++) {
        for (let z = 0; z <= 6; z++) {
            if (x === 3 && z === 3) {
                world.set(x, 63, z, 'water', { level: 0 });
                continue;
            }
            if (x === c.x && z === c.z) continue;
            world.set(x, 63, z, 'farmland', { moisture: 7 });
            const age = ages(x, z);
            if (age !== null) world.set(x, 64, z, 'wheat', { age });
        }
    }
    world.set(c.x, 63, c.z, 'dirt');
    world.set(c.x, c.y, c.z, 'composter', { level });
    const bot = makeFakeBot({ world, pos });
    for (let x = -1; x <= 7; x++) {
        for (let z = -1; z <= 7; z++) {
            if (x !== -1 && x !== 7 && z !== -1 && z !== 7) continue;
            if (x === 3 && z === -1) {
                world.gate(3, 64, -1, { facing: 'south' });
                continue;
            }
            world.set(x, 64, z, 'oak_fence');
            bot.blocked.add(`${x},64,${z}`);
        }
    }
    bot.unequip = async () => { bot.heldItem = null; };
    bot.readyComposters = [];
    bot.onActivate = (block) => {
        const p = block.position;
        const name = world.nameAt(p.x, p.y, p.z);
        const props = world.propsAt(p.x, p.y, p.z);
        const held = bot.heldItem && bot.heldItem.count > 0 ? bot.heldItem : null;
        if (name === 'composter') {
            const lv = props.level ?? 0;
            if (lv === 8) {
                world.setProps(p.x, p.y, p.z, { level: 0 });
                dropItem(bot, 'bone_meal', { x: p.x + 0.1, y: p.y + 1, z: p.z + 0.5 });
            } else if (held && ['leaf_litter', 'oak_leaves'].includes(held.name) && lv < 7) {
                held.count--;
                world.setProps(p.x, p.y, p.z, { level: lv + 1 });
                if (lv + 1 === 7) bot.readyComposters.push(p);
            }
            return;
        }
        if (!held) return;
        if (held.name === 'wheat_seeds' && name === 'farmland' && world.nameAt(p.x, p.y + 1, p.z) === 'air') {
            world.set(p.x, p.y + 1, p.z, 'wheat', { age: 0 });
            held.count--;
        } else if (held.name === 'bone_meal' && name === 'wheat' && (props.age ?? 0) < 7) {
            world.setProps(p.x, p.y, p.z, { age: Math.min(7, (props.age ?? 0) + 3) });
            held.count--;
        }
    };
    bot.drops = new Map(); // "x,z" of a plant -> where its wheat lands instead of the inventory
    const baseDig = bot.dig;
    bot.dig = async (block) => {
        const p = block.position;
        const name = world.nameAt(p.x, p.y, p.z);
        const props = world.propsAt(p.x, p.y, p.z);
        await baseDig(block);
        if (name === 'wheat' && (props.age ?? 0) >= 7) {
            const lands = bot.drops.get(`${p.x},${p.z}`);
            if (lands) dropItem(bot, 'wheat', lands.pos, { stuck: lands.stuck });
            else add(bot, 'wheat', 1);
            add(bot, 'wheat_seeds', 2);
        }
    };
    const sim = makeSim(bot, {
        onStep() {
            for (const q of bot.readyComposters.splice(0)) world.setProps(q.x, q.y, q.z, { level: 8 });
            const b = bot.entity.position;
            for (const e of Object.values(bot.entities)) {
                if (e.name !== 'item' || e.stuck) continue;
                if (Math.hypot(e.position.x - b.x, e.position.z - b.z) > 1.3 || Math.abs(e.position.y - b.y) > 1.5) continue;
                add(bot, e.getDroppedItem().name, 1);
                e.isValid = false;
                delete bot.entities[e.id];
            }
        },
    });
    // every place the bot stood after a walk, and the goals it was given
    bot.stood = [];
    const baseGoto = bot.gotoImpl;
    bot.gotoImpl = async (goal) => {
        try {
            return await baseGoto(goal);
        } finally {
            const q = bot.entity.position;
            bot.stood.push({ x: Math.floor(q.x), y: Math.floor(q.y + 0.2), z: Math.floor(q.z) });
        }
    };
    const area = { name: 'farm', type: 'farm', dimension: 'overworld', source: 'player', min: { x: -1, y: 62, z: -1 }, max: { x: 7, y: 66, z: 7 },
        entrances: [{ x: 3, y: 64, z: -1, kind: 'gate' }] };
    return { world, bot, sim, c, ctx: { areas: [area] } };
}

const goalCells = bot => bot.calls.filter(c => c[0] === 'goto').map(c => c[1]).filter(g => Number.isFinite(g?.x)).map(g => ({ x: g.x, y: g.y, z: g.z }));
const farmland = world => { let n = 0; for (let x = 0; x <= 6; x++) for (let z = 0; z <= 6; z++) if (world.nameAt(x, 63, z) === 'farmland') n++; return n; };
const itemsLeft = bot => Object.values(bot.entities).filter(e => e.name === 'item');

describe('X1, X2 the skills: the work at the composter from a free place beside it', () => {
    test('!makeBoneMeal at the composter of the farm: never a goal in or on it, the bone meal on the rim is picked up from beside it', async () => {
        const f = fakeFarm({ level: 8 });
        give(f.bot, 'leaf_litter', 7);
        const r = await F.makeBoneMeal(f.bot, f.ctx, 2, { now: f.sim.now, wait: f.sim.wait });
        assert.equal(r.text, 'I made 2 bone_meal from 7 items.');
        assert.equal(countOf(f.bot, 'bone_meal'), 2);
        assert.deepEqual(itemsLeft(f.bot), [], 'nothing lies on the ground');
        for (const g of goalCells(f.bot)) assert.ok(!inOrOn(g, f.c), `a goal in or on the composter: ${JSON.stringify(g)}`);
        for (const p of f.bot.stood) assert.ok(!inOrOn(p, f.c), `the bot stood in or on the composter: ${JSON.stringify(p)}`);
        assert.equal(f.world.propsAt(3, 64, -1).open, false, 'the gate of the farm is closed at the end');
        assert.ok(f.bot.entity.position.z < -1, 'out of the field');
        assert.equal(farmland(f.world), 47);
    });

    test('!farmCycle with unripe wheat: bone meal from the composter, every walk in the field careful, no goal in or on a composter or fence', async () => {
        const f = fakeFarm({ ages: () => 4, level: 0 });
        give(f.bot, 'leaf_litter', 14);
        const inField = [];
        const base = f.bot.gotoImpl;
        f.bot.gotoImpl = (goal) => {
            const q = f.bot.entity.position;
            if (!isPassingThrough(f.bot) && q.x >= 0 && q.x < 7 && q.z >= 0 && q.z < 7) inField.push(f.bot.pathfinder.movements);
            return base(goal);
        };
        const r = await F.farmCycle(f.bot, f.ctx, '', { now: f.sim.now, wait: f.sim.wait });
        assert.equal(r.ok, true, r.text);
        assert.match(r.text, /I made 2 bone_meal from 14 leaf_litter and used them\. 2 more plants got ripe and I harvested them\./);
        for (const g of goalCells(f.bot)) {
            assert.ok(!inOrOn(g, f.c), `a goal in or on the composter: ${JSON.stringify(g)}`);
        }
        for (const p of f.bot.stood) {
            assert.ok(!inOrOn(p, f.c), `the bot stood in or on the composter: ${JSON.stringify(p)}`);
            assert.ok(!(p.y === 64 && (p.x === -1 || p.x === 7 || p.z === 7)), `the bot stood in the fence: ${JSON.stringify(p)}`);
        }
        assert.ok(inField.length > 0);
        for (const m of inField) {
            assert.equal(m.allowParkour, false);
            assert.equal(m.allowSprinting, false);
            assert.ok(m.exclusionAreasStep.some(fn => fn({ position: v(1, 66, 1) }) >= 100), 'no jump in the field');
            assert.ok(m.exclusionAreasStep.some(fn => fn({ position: v(5, 65, 0) }) >= 100), 'not onto the composter');
        }
        assert.equal(farmland(f.world), 47, 'no farmland became dirt');
        assert.deepEqual(itemsLeft(f.bot), []);
        assert.equal(f.world.propsAt(3, 64, -1).open, false);
    });
});

describe('X14 the numbers of the texts are what the inventory gained; items left near the work are picked up at the end', () => {
    test('a wheat that cannot be picked up is not counted as harvested', async () => {
        const f = fakeFarm({ ages: (x, z) => (z === 0 && x <= 1 ? 7 : 3) });
        f.bot.drops.set('1,0', { pos: { x: 1.5, y: 64, z: 0.5 }, stuck: true });
        const r = await F.harvestCrops(f.bot, f.ctx, '', { now: f.sim.now, wait: f.sim.wait });
        assert.equal(r.harvested, 1);
        assert.equal(r.text, 'I harvested 1 wheat and planted 2 again. I could not pick up the crop of 1 plant. 45 plants are not ripe yet.');
        assert.equal(countOf(f.bot, 'wheat'), 1);
    });

    test('a wheat that fell outside the fence is picked up at the end, after the bot left the field, and then counted', async () => {
        const f = fakeFarm({ ages: (x, z) => (z === 0 && (x === 4 || x === 6) ? 7 : 3) });
        // 2.8 blocks north of the plant at (6, 0), beyond the fence (z -1): not in the field, not near the gate
        f.bot.drops.set('6,0', { pos: { x: 6.5, y: 64, z: -2.3 } });
        const r = await F.harvestCrops(f.bot, f.ctx, '', { now: f.sim.now, wait: f.sim.wait });
        assert.equal(countOf(f.bot, 'wheat'), 2);
        assert.equal(r.harvested, 2);
        assert.match(r.text, /^I harvested 2 wheat and planted 2 again\. /);
        assert.deepEqual(itemsLeft(f.bot), []);
        assert.equal(f.world.propsAt(3, 64, -1).open, false, 'the gate is closed after the pick-up outside');
        assert.equal(farmland(f.world), 47);
    });

    test('a bone meal the composter gave that was not picked up at once is picked up at the end and counted as made', async () => {
        const f = fakeFarm({ level: 8 });
        // the bone meal rolls onto the farmland 2 blocks from the bot; for 5.5 s no walk gets there (takeBoneMeal tries it once
        // and then waits at the composter), later one does
        let emptied = null;
        f.bot.onActivate = ((orig) => (block) => {
            const p = block.position;
            if (f.world.nameAt(p.x, p.y, p.z) === 'composter' && (f.world.propsAt(p.x, p.y, p.z).level ?? 0) === 8) {
                f.world.setProps(p.x, p.y, p.z, { level: 0 });
                dropItem(f.bot, 'bone_meal', { x: 6.5, y: 63.9375, z: 1.5 });
                emptied = f.sim.now();
                return;
            }
            orig(block);
        })(f.bot.onActivate);
        let refused = 0;
        const base = f.bot.gotoImpl;
        f.bot.gotoImpl = (goal) => {
            if (goal.x === 6 && goal.z === 1 && emptied !== null && f.sim.now() < emptied + 5500) {
                refused++;
                return Promise.reject(Object.assign(new Error('no path'), { name: 'NoPath' }));
            }
            return base(goal);
        };
        const r = await F.makeBoneMeal(f.bot, f.ctx, 1, { now: f.sim.now, wait: f.sim.wait });
        assert.ok(refused >= 1, 'the walk of takeBoneMeal failed');
        assert.equal(countOf(f.bot, 'bone_meal'), 1);
        assert.equal(r.made, 1);
        assert.match(r.text, /^I made 1 bone_meal from 0 items\./);
        assert.deepEqual(itemsLeft(f.bot), []);
    });

    test('texts: lostCropText, harvestText and ripenedText with plants whose crop was not picked up', () => {
        assert.equal(T.lostCropText(1), 'I could not pick up the crop of 1 plant.');
        assert.equal(T.lostCropText(3), 'I could not pick up the crop of 3 plants.');
        assert.equal(T.harvestText({ byCrop: { wheat: 1 }, replanted: 2, unripe: 0, lost: 1 }),
            'I harvested 1 wheat and planted 2 again. I could not pick up the crop of 1 plant.');
        assert.equal(T.harvestText({ byCrop: { wheat: 0 }, replanted: 2, unripe: 0, lost: 2 }),
            'I cut 2 ripe plants and planted 2 again. I could not pick up the crop of 2 plants.');
        assert.equal(T.harvestText({ byCrop: { wheat: 9 }, replanted: 9, unripe: 6 }), 'I harvested 9 wheat and planted 9 again. 6 plants are not ripe yet.');
        assert.equal(T.ripenedText(1, 1), '2 more plants got ripe and I cut them. I could not pick up the crop of 1 plant.');
        assert.equal(T.ripenedText(0, 1), '1 more plant got ripe and I cut it. I could not pick up the crop of 1 plant.');
        assert.equal(T.ripenedText(2), '2 more plants got ripe and I harvested them.');
        assert.equal(T.ripenedText(0), 'No plant got ripe yet.');
        // seen in the world runs of the fix round: "I made 3 bone_meal ... and used none of it."
        assert.equal(T.boneMealStepText({ made: 3, compost: { leaf_litter: 40 }, sources: { carried: 0, chest: 40, picked: 0 },
            compostChests: [{ x: 1, y: 2, z: 3 }], used: 0 }), 'I made 3 bone_meal from 40 leaf_litter of the chest at (1, 2, 3) and used none of them.');
    });
});
