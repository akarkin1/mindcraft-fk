// Spec v0.1.4.10 part R (engineer E3), R1 and R2 on the reflex: the item reflex never opens a gate and
// never walks into a pen, a farm or a no_enter area while the bot is outside it.
//   - the pure logic of src/agent/areas/keep_out_logic.js;
//   - the cost on the real Movements of mineflayer-pathfinder: a move into a gate is dropped;
//   - the mode item_collecting of modes.js with the real ActionManager on the fake bot of
//     tests/helpers/st_modes_env.js: no walk to an item in a pen, the text once, every walk (the try
//     again too) with the cost, an item in the pen taken when the bot is inside.
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import pf from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { loadModes, makeFakeBot, makeFakeAgent, freshPos, itemEntity } from '../helpers/st_modes_env.js';

const L = await loadSrc('src/agent/areas/keep_out_logic.js');
const K = await loadSrc('src/agent/areas/keep_out.js');
const M = await loadModes();
await import('ses'); // the global assert of the agent process

const LIMIT = { timeout: 30000 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const realNow = Date.now;
let offset = 0;

const TEXT = 'I leave the oak_fence in the pen "pen". I do not open its gate.';

function area(name, type, min, max, extra = {}) {
    return { name, type, min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] }, dimension: 'overworld',
        entrances: [], ...extra };
}

// ------------------------------------------------------------------------------- the logic

describe('R1: keep_out_logic', () => {
    const pen = area('pen', 'pen', [10, 62, 10], [20, 67, 20]);

    test('a gate of any wood, with or without the prefix', () => {
        assert.equal(L.isGateName('oak_fence_gate'), true);
        assert.equal(L.isGateName('minecraft:spruce_fence_gate'), true);
        assert.equal(L.isGateName('oak_fence'), false);
        assert.equal(L.isGateName('oak_door'), false);
        assert.equal(L.isGateName(null), false);
    });

    test('the areas kept out: pen, farm, and any area with no_enter', () => {
        assert.equal(L.isKeepOutArea(pen), true);
        assert.equal(L.isKeepOutArea(area('farm', 'farm', [0, 0, 0], [3, 3, 3])), true);
        assert.equal(L.isKeepOutArea(area('home', 'home', [0, 0, 0], [3, 3, 3])), false);
        assert.equal(L.isKeepOutArea(area('home', 'home', [0, 0, 0], [3, 3, 3], { flags: { no_enter: true } })), true);
        assert.equal(L.isKeepOutArea(area('mine', 'mine', [0, 0, 0], [3, 3, 3], { flags: { no_enter: false } })), false);
        assert.equal(L.isKeepOutArea(null), false);
        assert.equal(L.isKeepOutArea({ type: 'pen' }), false, 'no box');
    });

    test('inside: both corners count, positions are floored', () => {
        assert.equal(L.insideArea(pen, { x: 10, y: 62, z: 10 }), true);
        assert.equal(L.insideArea(pen, { x: 20.9, y: 67.9, z: 20.9 }), true);
        assert.equal(L.insideArea(pen, { x: 9.9, y: 64, z: 15 }), false);
        assert.equal(L.insideArea(pen, { x: 15, y: 68, z: 15 }), false);
        assert.equal(L.insideArea(pen, null), false);
    });

    test('keepOutAreas: only those the bot is outside of, in its dimension', () => {
        const nether = { ...area('hell_pen', 'pen', [10, 62, 10], [20, 67, 20]), dimension: 'the_nether' };
        const home = area('home', 'home', [0, 60, 0], [8, 70, 8]);
        const list = [pen, nether, home];
        assert.deepEqual(L.keepOutAreas(list, { x: 0.5, y: 64, z: 0.5 }, 'minecraft:overworld').map((a) => a.name), ['pen']);
        assert.deepEqual(L.keepOutAreas(list, { x: 15.5, y: 64, z: 15.5 }, 'overworld'), [], 'the bot is inside the pen');
        assert.deepEqual(L.keepOutAreas(list, { x: 0.5, y: 64, z: 0.5 }, 'the_nether').map((a) => a.name), ['hell_pen']);
        assert.deepEqual(L.keepOutAreas(null, { x: 0, y: 0, z: 0 }), []);
    });

    test('stepCost: 100 for a gate anywhere and for a cell inside, 0 elsewhere, never throws', () => {
        const areas = [pen];
        assert.equal(L.KEEP_OUT_COST, 100);
        assert.equal(L.stepCost({ name: 'oak_fence_gate', position: { x: 0, y: 64, z: 0 } }, []), 100);
        assert.equal(L.stepCost({ name: 'air', position: { x: 15, y: 64, z: 15 } }, areas), 100);
        assert.equal(L.stepCost({ name: 'air', position: { x: 5, y: 64, z: 5 } }, areas), 0);
        assert.equal(L.stepCost(null, areas), 0);
        assert.equal(L.stepCost({ name: 'air', get position() { throw new Error('x'); } }, areas), 0);
        const fn = L.stepCostOf(areas);
        assert.equal(fn({ name: 'air', position: { x: 12, y: 63, z: 12 } }), 100);
    });

    test('the text, word for word, and once a minute', () => {
        assert.equal(L.leaveText('oak_fence', pen), TEXT);
        assert.equal(L.leaveText('wheat_seeds', area('field', 'farm', [0, 0, 0], [3, 3, 3])),
            'I leave the wheat_seeds in the farm "field". I do not open its gate.');
        assert.equal(L.mayLeaveText(null, 1000), true);
        assert.equal(L.mayLeaveText(1000, 60999), false);
        assert.equal(L.mayLeaveText(1000, 61000), true);
        assert.equal(L.itemNameOf({ getDroppedItem: () => ({ name: 'oak_fence' }) }), 'oak_fence');
        assert.equal(L.itemNameOf({ getDroppedItem: () => { throw new Error('x'); } }), 'item');
        assert.equal(L.itemNameOf({}), 'item');
    });
});

// ---------------------------------------------------------- the real Movements of the path search

describe('R1: the cost on the Movements of mineflayer-pathfinder', () => {
    test('a move into a gate cell is dropped, a move into a pen cell too, a move elsewhere stays', () => {
        const world = createBlockWorld().flatGround(63);
        world.set(3, 64, 0, 'oak_fence_gate');
        const bot = makeFakeBot({ world, pos: [0.5, 64, 0.5], realBlocks: true });
        const node = new Vec3(2, 64, 0);
        node.remainingBlocks = 0;
        const forward = (m, dir) => {
            const out = [];
            m.getMoveForward(node, dir, out);
            return out.map((n) => [n.x, n.y, n.z]);
        };
        const free = new pf.Movements(bot);
        assert.deepEqual(forward(free, { x: 1, z: 0 }), [[3, 64, 0]], 'without the cost the path search opens the gate');
        const m = new pf.Movements(bot);
        m.exclusionAreasStep.push(L.stepCostOf([area('pen', 'pen', [2, 62, 1], [6, 67, 6])]));
        assert.deepEqual(forward(m, { x: 1, z: 0 }), [], 'into the gate');
        assert.deepEqual(forward(m, { x: 0, z: 1 }), [], 'into the pen');
        assert.deepEqual(forward(m, { x: -1, z: 0 }), [[1, 64, 0]], 'away from both');
    });
});

// ------------------------------------------------------------------------------- the mode

describe('R1: the mode item_collecting', () => {
    let cap;
    before(() => { Date.now = () => realNow() + offset; });
    after(() => { Date.now = realNow; });
    beforeEach(() => {
        cap = captureConsole();
        offset += 10 * 60 * 1000;
        M.settingsModule.setSettings({ language: 'en', narrate_behavior: false, home_pack: false });
    });
    afterEach(() => cap.restore());

    async function settle(agent, ms = 15000) {
        await sleep(350);
        const end = realNow() + ms;
        while (agent.actions.executing && realNow() < end) await sleep(10);
        await sleep(50);
    }

    // A bot at freshPos with a pen 5 to 9 blocks east of it (x +4..+8, z -2..+2) and an agent with the store.
    function setup(areas) {
        const pos = freshPos();
        const bot = makeFakeBot({ pos });
        const agent = makeFakeAgent(M, bot, { on: ['item_collecting'] });
        const bx = Math.floor(pos[0]);
        const list = typeof areas === 'function' ? areas(bx) : areas;
        agent.area_store = { list: () => list.map((a) => ({ ...a })) };
        agent.said = [];
        agent.sayText = (text) => agent.said.push(text);
        const walks = () => bot.calls.filter((c) => c[0] === 'goto' && c[1] === 'GoalFollow').length;
        return { bot, agent, bx, walks };
    }
    const penAt = (bx, extra = {}) => area('pen', 'pen', [bx + 4, 62, -2], [bx + 8, 67, 2], extra);

    test('8 fences inside the pen, the bot outside: no walk, the text once, not again within a minute', LIMIT, async () => {
        const { bot, agent, bx, walks } = setup((x) => [penAt(x)]);
        const fence = itemEntity('oak_fence', [bx + 6.5, 64, 0.5]);
        bot.entities[fence.id] = fence;
        await bot.modes.update();
        offset += 2100;
        await bot.modes.update();
        await settle(agent);
        assert.equal(walks(), 0, 'no walk to the fences');
        assert.deepEqual(agent.labels, [], 'no action of the mode');
        assert.deepEqual(agent.said, [TEXT]);
        assert.ok(bot.modes.behavior_log.includes(TEXT), 'the behaviour log has it');
        const second = itemEntity('oak_fence', [bx + 5.5, 64, 0.5]);
        bot.entities[second.id] = second;
        offset += 30000;
        await bot.modes.update();
        assert.equal(agent.said.length, 1, 'not again within a minute');
        offset += 31000;
        await bot.modes.update();
        assert.equal(agent.said.length, 2, 'a new item after a minute: again');
        offset += 61000;
        await bot.modes.update();
        assert.equal(agent.said.length, 2, 'the same items: not again');
        assert.equal(walks(), 0);
    });

    test('an item outside the pen: picked up, the walk with the cost for the gates and the pen; the try again too', LIMIT, async () => {
        const { bot, agent, bx, walks } = setup((x) => [penAt(x)]);
        const item = itemEntity('dirt', [bx - 2.5, 64, 0.5]);
        bot.entities[item.id] = item;
        const movements = [];
        const setMovements = bot.pathfinder.setMovements;
        bot.pathfinder.setMovements = (m) => { movements.push(m); setMovements(m); };
        await bot.modes.update();
        offset += 2100;
        await bot.modes.update();
        await settle(agent);
        assert.equal(walks(), 1, 'the first walk');
        offset += 3100;
        await bot.modes.update(); // nothing gained: the try again after 3 s
        await settle(agent);
        assert.equal(walks(), 2, 'the try again');
        assert.equal(movements.length, 2);
        for (const m of movements) {
            assert.equal(m.canDig, false);
            const costs = m.exclusionAreasStep.map((fn) => [
                fn({ name: 'oak_fence_gate', position: new Vec3(bx - 20, 64, 0) }),
                fn({ name: 'air', position: new Vec3(bx + 6, 64, 0) }),
                fn({ name: 'air', position: new Vec3(bx - 1, 64, 0) }),
            ]);
            assert.ok(costs.some(([gate, pen, free]) => gate === 100 && pen === 100 && free === 0), JSON.stringify(costs));
        }
        assert.deepEqual(agent.said, []);
    });

    test('the walk never goes on to an item in the pen after the first item', LIMIT, async () => {
        const { bot, agent, bx } = setup((x) => [penAt(x)]);
        const near = itemEntity('dirt', [bx - 1.5, 64, 0.5]);
        const inPen = itemEntity('oak_fence', [bx + 5.5, 64, 0.5]);
        bot.entities[near.id] = near;
        bot.entities[inPen.id] = inPen;
        const targets = [];
        bot.gotoImpl = async (goal) => { targets.push(goal.entity?.id); delete bot.entities[goal.entity?.id]; };
        await bot.modes.update();
        offset += 2100;
        await bot.modes.update();
        await settle(agent);
        assert.deepEqual(targets, [near.id], 'only the item outside');
        assert.ok(bot.entities[inPen.id], 'the fence stays');
    });

    test('a rule area: no_enter on an area of type home is kept out like a pen', LIMIT, async () => {
        const { bot, agent, bx, walks } = setup((x) => [area('chicken_pen', 'home', [x + 4, 62, -2], [x + 8, 67, 2], { flags: { no_enter: true } })]);
        const egg = itemEntity('egg', [bx + 6.5, 64, 0.5]);
        bot.entities[egg.id] = egg;
        await bot.modes.update();
        offset += 2100;
        await bot.modes.update();
        await settle(agent);
        assert.equal(walks(), 0);
        assert.deepEqual(agent.said, ['I leave the egg in the home "chicken_pen". I do not open its gate.']);
    });

    test('the bot inside the pen: the item inside is picked up as before', LIMIT, async () => {
        const { bot, agent, bx, walks } = setup((x) => [area('pen', 'pen', [x - 3, 62, -3], [x + 3, 67, 3])]);
        const item = itemEntity('oak_fence', [bx + 2.5, 64, 0.5]);
        bot.entities[item.id] = item;
        await bot.modes.update();
        offset += 2100;
        await bot.modes.update();
        await settle(agent);
        assert.equal(walks(), 1);
        assert.deepEqual(agent.said, []);
    });

    test('no area store: items are picked up as before, no text', LIMIT, async () => {
        const pos = freshPos();
        const bot = makeFakeBot({ pos });
        const agent = makeFakeAgent(M, bot, { on: ['item_collecting'] });
        const item = itemEntity('dirt', [pos[0] + 2, 64, 0.5]);
        bot.entities[item.id] = item;
        await bot.modes.update();
        offset += 2100;
        await bot.modes.update();
        await settle(agent);
        assert.equal(bot.calls.filter((c) => c[0] === 'goto' && c[1] === 'GoalFollow').length, 1);
    });
});

// ------------------------------------------------------------------------------- collectItems alone

describe('R1: collectItems', () => {

    test('an interrupt during the walk ends it with reason interrupted, nothing stays open', LIMIT, async () => {
        const bot = makeFakeBot({ pos: [0.5, 64, 0.5] });
        const item = itemEntity('dirt', [3, 64, 0.5]);
        bot.entities[item.id] = item;
        bot.gotoImpl = () => new Promise(() => {});
        setTimeout(() => { bot.interrupt_code = true; }, 50);
        const r = await K.collectItems(bot, { first: item });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'interrupted');
        assert.equal(r.text, 'I was stopped after 0 items.');
        assert.ok(bot.pathfinder.goals.includes(null), 'the path search is stopped');
    });

    test('never throws: a bot without a path finder gives reason error', async () => {
        const bot = makeFakeBot({ pos: [0.5, 64, 0.5] });
        const item = itemEntity('dirt', [3, 64, 0.5]);
        bot.entities[item.id] = item;
        bot.pathfinder = null;
        const r = await K.collectItems(bot, { first: item });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'error');
    });

    test('a first item inside an area is no target', async () => {
        const bot = makeFakeBot({ pos: [0.5, 64, 0.5] });
        const item = itemEntity('dirt', [3, 64, 0.5]);
        bot.entities[item.id] = item;
        const r = await K.collectItems(bot, { first: item, areas: [area('pen', 'pen', [2, 60, -2], [6, 70, 2])] });
        assert.deepEqual([r.ok, r.picked, r.text], [true, 0, 'Picked up 0 items.']);
        assert.equal(bot.calls.filter((c) => c[0] === 'goto').length, 0);
    });
});
