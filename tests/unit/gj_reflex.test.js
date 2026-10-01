// Tester T1 of v0.1.4.10 "Goals", from the spec (I6, R1, section 7) and the handoff of part R: the item reflex never
// opens a pen gate. The walk uses Movements whose exclusionAreasStep gives 100 for a gate cell and for every cell of
// a pen or farm (or a no_enter area) the bot is outside of; an item inside such an area is never picked while the bot
// is outside; the text once a minute. The mode runs on the fake bot of tests/helpers/st_modes_env.js with a mocked
// Date.now.
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import pf from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { loadModes, makeFakeBot, makeFakeAgent, freshPos, itemEntity } from '../helpers/st_modes_env.js';

const L = await loadSrc('src/agent/areas/keep_out_logic.js');
const M = await loadModes();
await import('ses'); // the agent process has the global assert of ses

const PEN_TEXT = 'I leave the oak_fence in the pen "pen". I do not open its gate.';
const realNow = Date.now;
let offset = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function area(name, type, min, max, extra = {}) {
    return { name, type, min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] }, dimension: 'overworld', entrances: [], ...extra };
}

describe('R1: the cost of the walk', () => {
    const pen = area('pen', 'pen', [10, 60, 10], [16, 66, 16]);
    const farm = area('farm', 'farm', [20, 60, 10], [26, 66, 16]);
    const ruled = area('chicken pen', 'building', [30, 60, 10], [36, 66, 16], { flags: { no_enter: true } });
    const house = area('home', 'home', [40, 60, 10], [46, 66, 16]);
    const outside = { x: 0.5, y: 64, z: 0.5 };

    test('a gate cell costs 100, anywhere', () => {
        assert.equal(L.stepCost({ name: 'oak_fence_gate', position: new Vec3(0, 64, 0) }, []), 100);
        assert.equal(L.stepCost({ name: 'birch_fence_gate', position: new Vec3(99, 64, 99) }, [pen]), 100);
    });

    test('every cell inside a pen, a farm or a no_enter area costs 100 when the bot is outside; elsewhere 0', () => {
        const keep = L.keepOutAreas([pen, farm, ruled, house], outside, 'overworld');
        assert.deepEqual(keep.map((a) => a.name).sort(), ['chicken pen', 'farm', 'pen']);
        const cost = L.stepCostOf(keep);
        assert.equal(cost({ name: 'air', position: new Vec3(12, 63, 12) }), 100, 'pen');
        assert.equal(cost({ name: 'air', position: new Vec3(22, 63, 12) }), 100, 'farm');
        assert.equal(cost({ name: 'air', position: new Vec3(32, 63, 12) }), 100, 'no_enter');
        assert.equal(cost({ name: 'air', position: new Vec3(42, 63, 12) }), 0, 'home');
        assert.equal(cost({ name: 'air', position: new Vec3(5, 63, 5) }), 0, 'open ground');
    });

    test('the bot inside the pen: the pen is free for it, the gate still costs 100', () => {
        const keep = L.keepOutAreas([pen], { x: 12.5, y: 61, z: 12.5 }, 'overworld');
        assert.deepEqual(keep, []);
        assert.equal(L.stepCostOf(keep)({ name: 'air', position: new Vec3(13, 61, 13) }), 0);
        assert.equal(L.stepCostOf(keep)({ name: 'oak_fence_gate', position: new Vec3(10, 61, 13) }), 100);
    });

    test('on the real Movements a move into a gate is not offered', () => {
        const world = createBlockWorld().flatGround(63);
        world.set(1, 64, 0, 'oak_fence_gate');
        const bot = makeFakeBot({ world, pos: [0.5, 64, 0.5], realBlocks: true });
        const m = new pf.Movements(bot);
        m.exclusionAreasStep.push(L.stepCostOf([]));
        const start = new Vec3(0, 64, 0);
        start.remainingBlocks = 0;
        const out = [];
        m.getMoveForward(start, { x: 1, z: 0 }, out);
        assert.deepEqual(out.filter((n) => n.x === 1), [], JSON.stringify(out.map((n) => [n.x, n.y, n.z, n.cost])));
    });

    test('the text, word for word', () => {
        assert.equal(L.leaveText('oak_fence', pen), PEN_TEXT);
    });
});

describe('R1: the mode item_collecting', () => {
    let cap;
    before(() => { Date.now = () => realNow() + offset; });
    after(() => { Date.now = realNow; });
    beforeEach(() => {
        cap = captureConsole();
        offset += 10 * 60_000;
        M.settingsModule.setSettings({ language: 'en', narrate_behavior: false, home_pack: false });
    });
    afterEach(() => cap.restore());

    async function idle(agent) {
        await sleep(300);
        const end = realNow() + 15_000;
        while (agent.actions.executing && realNow() < end) await sleep(10);
    }

    function scene(makeAreas) {
        const pos = freshPos();
        const bot = makeFakeBot({ pos });
        const agent = makeFakeAgent(M, bot, { on: ['item_collecting'] });
        const x = Math.floor(pos[0]);
        const areas = makeAreas(x);
        agent.area_store = { list: () => areas.map((a) => ({ ...a })) };
        agent.said = [];
        agent.sayText = (text) => agent.said.push(text);
        const walks = () => bot.calls.filter((c) => c[0] === 'goto').length;
        return { bot, agent, x, walks };
    }

    async function twoUpdates(bot) {
        await bot.modes.update();
        offset += 2_500; // the mode waits 2 s after it noticed an item
        await bot.modes.update();
    }

    test('8 fences in the pen, the bot outside: no walk; the text once, again only after a minute for a new item', { timeout: 30_000 }, async () => {
        const { bot, agent, x, walks } = scene((bx) => [area('pen', 'pen', [bx + 3, 60, -3], [bx + 7, 66, 3])]);
        for (let i = 0; i < 8; i++) {
            const fence = itemEntity('oak_fence', [x + 4.5 + (i % 3), 64, -1.5 + (i % 2)]);
            bot.entities[fence.id] = fence;
        }
        await twoUpdates(bot);
        await idle(agent);
        assert.equal(walks(), 0, 'no walk into the pen');
        assert.deepEqual(agent.said, [PEN_TEXT]);
        offset += 20_000;
        await bot.modes.update();
        assert.equal(agent.said.length, 1, 'not within a minute');
        const another = itemEntity('oak_fence', [x + 5.5, 64, 2.5]);
        bot.entities[another.id] = another;
        offset += 45_000;
        await bot.modes.update();
        assert.ok(agent.said.length <= 2, 'at most once a minute');
        assert.equal(walks(), 0);
    });

    test('an item in a farm and an item in a no_enter area are left too', { timeout: 30_000 }, async () => {
        const { bot, agent, x, walks } = scene((bx) => [area('field', 'farm', [bx + 3, 60, -3], [bx + 6, 66, 3]),
            area('chicken pen', 'building', [bx - 6, 60, -3], [bx - 3, 66, 3], { flags: { no_enter: true } })]);
        const seeds = itemEntity('wheat_seeds', [x + 4.5, 64, 0.5]);
        const egg = itemEntity('egg', [x - 4.5, 64, 0.5]);
        bot.entities[seeds.id] = seeds;
        bot.entities[egg.id] = egg;
        await twoUpdates(bot);
        await idle(agent);
        assert.equal(walks(), 0);
        assert.equal(agent.said.length, 1, agent.said.join(' | '));
        assert.match(agent.said[0], /^I leave the (wheat_seeds|egg) in the \w+ "(field|chicken pen)"\. I do not open its gate\.$/);
    });

    test('an item outside the pen is picked up, and the walk carries the gate and pen cost', { timeout: 30_000 }, async () => {
        const { bot, agent, x, walks } = scene((bx) => [area('pen', 'pen', [bx + 3, 60, -3], [bx + 7, 66, 3])]);
        const dirt = itemEntity('dirt', [x - 2.5, 64, 0.5]);
        bot.entities[dirt.id] = dirt;
        const used = [];
        const set = bot.pathfinder.setMovements;
        bot.pathfinder.setMovements = (m) => { used.push(m); set(m); };
        await twoUpdates(bot);
        await idle(agent);
        assert.equal(walks(), 1);
        assert.ok(used.length >= 1);
        for (const m of used) {
            const sum = (block) => m.exclusionAreasStep.reduce((s, fn) => s + fn(block), 0);
            assert.ok(sum({ name: 'spruce_fence_gate', position: new Vec3(x - 30, 64, 0) }) >= 100, 'gate');
            assert.ok(sum({ name: 'air', position: new Vec3(x + 5, 64, 0) }) >= 100, 'pen cell');
            assert.equal(sum({ name: 'air', position: new Vec3(x - 1, 64, 0) }), 0, 'open ground');
        }
        assert.deepEqual(agent.said, []);
    });
});
