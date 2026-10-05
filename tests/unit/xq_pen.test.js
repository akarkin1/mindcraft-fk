// v0.1.4.13 part Q (engineer E4), SPEC 4.6 Q8: the enclosure rule of the pen. scanPenBehindGate of area_scan.js (the
// fenced ground behind a gate), the rules and texts of keep_out_logic.js (a saved pen or farm keeps out; the pen text;
// the pen word of !allowChanges), and the gate verdict of areas/pen_gate.js over a small world with animals: the gate of a
// pen with animals is kept closed, a closing click is not, a bot inside walks out, a permit opens it, the same fence
// without animals is no pen, a farm is no pen for the gate.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { assertImportRules } from '../helpers/module_rules.js';

const require = createRequire(import.meta.url);
const Vec3 = require('vec3');

const S = await loadSrc('src/agent/areas/area_scan.js');
const K = await loadSrc('src/agent/areas/keep_out_logic.js');
const G = await loadSrc('src/agent/areas/pen_gate.js');

const PEN_TEXT = 'That is a pen with 26 chickens; I do not open its gate. Say "open the pen" if you mean it.';

// oak fence 7 by 7 on grass at y 63 (x and z -3..3), the gate in the north side at (0, 64, -3)
function penWorld(gate = { open: false }) {
    const world = createBlockWorld().flatGround(63, 'grass_block', 'dirt');
    for (let i = -3; i <= 3; i++) {
        world.set(i, 64, -3, 'oak_fence');
        world.set(i, 64, 3, 'oak_fence');
        world.set(-3, 64, i, 'oak_fence');
        world.set(3, 64, i, 'oak_fence');
    }
    world.set(0, 64, -3, 'oak_fence_gate', { open: gate.open, facing: 'north', in_wall: false, powered: false });
    return world;
}

function names(world) {
    return (x, y, z) => world.get(x, y, z);
}

function blockOf(world, x, y, z) {
    const name = world.get(x, y, z);
    if (name === null || name === undefined) return null;
    const props = world._properties?.get?.(`${x},${y},${z}`) ?? {};
    return { name, position: new Vec3(x, y, z), _properties: props, getProperties: () => ({ ...props }) };
}

// a bot over the world: blockAt and entities (animals), at `pos`
function penBot(world, pos, animals = 0, kind = 'chicken') {
    const entities = {};
    for (let i = 0; i < animals; i++) {
        entities[100 + i] = { id: 100 + i, type: 'animal', name: kind, position: new Vec3(-2 + (i % 5), 64, -2 + Math.floor(i / 5) % 5) };
    }
    const calls = [];
    return {
        calls,
        username: 'claude',
        game: { dimension: 'overworld' },
        entity: { position: new Vec3(pos.x + 0.5, pos.y, pos.z + 0.5) },
        entities,
        blockAt: (p) => blockOf(world, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)),
        activateBlock: async (block) => { calls.push(block.position); },
        once() {},
    };
}

describe('Q8: the fenced ground behind a gate (scanPenBehindGate)', () => {
    test('the pen of 5 by 5 inside the fence, the box with the fence, the gate as its entrance', () => {
        const r = S.scanPenBehindGate(names(penWorld()), { x: 0, y: 64, z: -3 });
        assert.equal(r.found, true);
        assert.deepEqual([r.min, r.max], [{ x: -3, y: 62, z: -3 }, { x: 3, y: 66, z: 3 }]);
        assert.equal(r.cells, 25);
        assert.deepEqual(r.entrances, [{ x: 0, y: 64, z: -3, kind: 'gate' }]);
        assert.deepEqual(r.side, { x: 0, y: 64, z: -2 }, 'the side inside');
    });

    test('a fence with a gap is no pen; no gate at the cell is no pen', () => {
        const open = penWorld();
        open.set(3, 64, 0, 'air');
        assert.equal(S.scanPenBehindGate(names(open), { x: 0, y: 64, z: -3 }).found, false);
        assert.equal(S.scanPenBehindGate(names(penWorld()), { x: 1, y: 64, z: -3 }).reason, 'no_gate');
    });

    test('farmland inside: a farm, not a pen', () => {
        const farm = penWorld();
        farm.set(0, 63, 0, 'farmland');
        assert.equal(S.scanPenBehindGate(names(farm), { x: 0, y: 64, z: -3 }).found, false);
    });

    test('never throws', () => {
        assert.equal(S.scanPenBehindGate(null, { x: 0, y: 64, z: -3 }).found, false);
        assert.equal(S.scanPenBehindGate(names(penWorld()), null).found, false);
    });
});

describe('Q8: the rules and texts of keep_out_logic.js', () => {
    const box = { min: { x: 0, y: 63, z: 0 }, max: { x: 6, y: 66, z: 6 }, dimension: 'overworld' };

    test('isKeepOutArea holds for a saved pen or farm, by type or by kind', () => {
        assert.equal(K.isKeepOutArea({ name: 'a', type: 'pen', ...box }), true);
        assert.equal(K.isKeepOutArea({ name: 'b', type: 'farm', ...box }), true);
        assert.equal(K.isKeepOutArea({ name: 'c', kind: 'farm', type: 'building', ...box }), true);
        assert.equal(K.isKeepOutArea({ name: 'd', kind: 'pen', ...box }), true);
        assert.equal(K.isKeepOutArea({ name: 'e', type: 'storage', ...box }), false);
    });

    test('the enclosure a scan finds as a pen with animals keeps out (contents and a gate)', () => {
        const pen = { name: 'pen', kind: 'pen', min: box.min, max: box.max, entrances: [{ x: 3, y: 64, z: 0, kind: 'gate' }], contents: { animals: { chicken: 6 } } };
        assert.equal(K.isKeepOutArea(pen), true);
    });

    test('the gate rule: a pen keeps its gate, a farm does not (the farming pack walks in)', () => {
        assert.equal(K.isPenArea({ type: 'pen', ...box }), true);
        assert.equal(K.isPenArea({ type: 'farm', ...box }), false);
        assert.equal(K.isPenArea({ type: 'building', contents: { animals: { cow: 1 } }, entrances: [{ kind: 'gate' }], ...box }), true);
        const areas = [{ name: 'chicken_pen', type: 'pen', ...box }];
        assert.equal(K.savedPenOf(areas, { x: 7, y: 64, z: 3 }, 'overworld')?.name, 'chicken_pen', 'a gate in the fence line beside the box');
        assert.equal(K.savedPenOf(areas, { x: 9, y: 64, z: 3 }, 'overworld'), null);
        assert.equal(K.savedPenOf(areas, { x: 3, y: 64, z: 3 }, 'the_nether'), null);
    });

    test('the pen text, word for word, and the animals as words', () => {
        assert.equal(K.penText({ chicken: 26 }), PEN_TEXT);
        assert.equal(K.penText({ chicken: 6 }), 'That is a pen with 6 chickens; I do not open its gate. Say "open the pen" if you mean it.');
        assert.equal(K.penAnimalsText({ cow: 1, chicken: 6 }), '6 chickens and 1 cow');
        assert.equal(K.penAnimalsText({ sheep: 4, pig: 2, cow: 1 }), '4 sheep, 2 pigs and 1 cow');
        assert.equal(K.penAgainText({ x: 0, y: 64, z: -3 }), 'I do not open the gate of the pen at (0, 64, -3).');
    });

    test('the answers of "open the pen"', () => {
        assert.equal(K.penAllowedText({ chicken: 6 }, { x: 0, y: 64, z: -3 }, 10),
            'I may open the gate of the pen with 6 chickens at (0, 64, -3) for 10 minutes. I close it behind me.');
        assert.equal(K.noPenText('pen'), 'No area named "pen" is saved, and I see no pen with animals within 16 blocks.');
    });

    test('the pen word of !allowChanges: the kind word or the name the sense gives', () => {
        for (const name of ['pen', 'the pen', 'Pen', 'chicken pen', 'fenced pen', 'chicken_pen']) assert.equal(K.isPenWord(name), true, name);
        for (const name of ['home', 'pens', 'the open field', '', null]) assert.equal(K.isPenWord(name), false, String(name));
    });

    test('once per minute', () => {
        assert.equal(K.mayPenText(null, 1000), true);
        assert.equal(K.mayPenText(1000, 60999), false);
        assert.equal(K.mayPenText(1000, 61000), true);
    });

    test('keep_out_logic.js stays pure', () => {
        assertImportRules('src/agent/areas/keep_out_logic.js', { allowBuiltins: [], allowedRelative: [] });
    });
});

describe('Q8: the gate verdict of pen_gate.js', () => {
    const gateBlock = (world, open = false) => blockOf(world, 0, 64, -3) && { ...blockOf(world, 0, 64, -3), _properties: { open }, getProperties: () => ({ open }) };

    test('a pen with 26 chickens, the bot outside: the gate is kept closed, with the pen text', () => {
        const world = penWorld();
        const bot = penBot(world, { x: 0, y: 64, z: -5 }, 26);
        const r = G.penGateRefusal(bot, gateBlock(world));
        assert.equal(r?.text, PEN_TEXT);
        assert.deepEqual(r.pen.gate, { x: 0, y: 64, z: -3 });
    });

    test('a closing click (the gate open) is never refused; the bot inside walks out', () => {
        const world = penWorld();
        assert.equal(G.penGateRefusal(penBot(world, { x: 0, y: 64, z: -5 }, 26), gateBlock(world, true)), null);
        assert.equal(G.penGateRefusal(penBot(world, { x: 0, y: 64, z: 0 }, 26), gateBlock(world)), null);
    });

    test('the same fence without animals is no pen', () => {
        const world = penWorld();
        assert.equal(G.penGateRefusal(penBot(world, { x: 0, y: 64, z: -5 }, 0), gateBlock(world)), null);
    });

    test('the guard: the path search keeps the gate (keepGateClosed), a click is refused and the text said once', async () => {
        const world = penWorld();
        const bot = penBot(world, { x: 0, y: 64, z: -5 }, 26);
        const said = [];
        G.installPenGuard(bot, { say: (t) => said.push(t) });
        assert.equal(bot.keepGateClosed(gateBlock(world)), true);
        for (let i = 0; i < 2; i++) {
            await assert.rejects(bot.activateBlock(gateBlock(world)), { message: PEN_TEXT });
        }
        assert.deepEqual(bot.calls, [], 'the gate was not clicked');
        assert.deepEqual(said, [PEN_TEXT], 'said once within the minute');
        await bot.activateBlock(blockOf(world, 2, 63, 0));
        assert.equal(bot.calls.length, 1, 'another block is clicked as before');
    });

    test('"open the pen": the nearest pen with animals is permitted, then its gate opens', async () => {
        const world = penWorld();
        const bot = penBot(world, { x: 0, y: 64, z: -5 }, 6);
        G.installPenGuard(bot, {});
        const pen = G.permitPenNear(bot, 10);
        assert.deepEqual([pen?.gate, pen?.animals], [{ x: 0, y: 64, z: -3 }, { chicken: 6 }]);
        assert.equal(bot.keepGateClosed(gateBlock(world)), false);
        await bot.activateBlock(gateBlock(world));
        assert.equal(bot.calls.length, 1);
    });

    test('the path search keeps the gate and says the pen text when the player stands inside (the walk wanted in)', () => {
        const world = penWorld();
        const bot = penBot(world, { x: 0, y: 64, z: -5 }, 26);
        const said = [];
        G.installPenGuard(bot, { say: (t) => said.push(t) });
        assert.equal(bot.keepGateClosed(gateBlock(world)), true);
        assert.deepEqual(said, [], 'nobody inside, no goal inside: a walk past the pen says nothing');
        bot.entities[1] = { id: 1, type: 'player', username: 'MartyByrde2', position: new Vec3(0.5, 64, 1.5) };
        assert.equal(bot.keepGateClosed(gateBlock(world)), true);
        assert.deepEqual(said, [PEN_TEXT]);
    });

    test('a gate opened on the permit is closed behind the bot once it stands 2 blocks away', async () => {
        const world = penWorld();
        const bot = penBot(world, { x: 0, y: 64, z: -5 }, 6);
        bot.activateBlock = async (block) => {
            bot.calls.push(block.position);
            const open = world._properties.get('0,64,-3')?.open === true;
            world.set(0, 64, -3, 'oak_fence_gate', { open: !open, facing: 'north', in_wall: false, powered: false });
        };
        G.installPenGuard(bot, {});
        G.permitPenNear(bot, 10);
        await bot.activateBlock(gateBlock(world));
        assert.equal(world._properties.get('0,64,-3')?.open, true, 'opened');
        bot.entity.position = new Vec3(0.5, 64, 0.5); // the bot walked in, 3 blocks from the gate
        await new Promise(resolve => setTimeout(resolve, 2500));
        assert.equal(world._properties.get('0,64,-3')?.open, false, 'closed behind the bot');
        assert.equal(bot.calls.length, 2);
    });

    test('a saved pen keeps its gate until its permit of the area guard', () => {
        const world = penWorld();
        const bot = penBot(world, { x: 0, y: 64, z: -5 }, 0);
        let permits = [];
        G.installPenGuard(bot, { areas: () => [{ name: 'chicken pen', type: 'pen', min: { x: -2, y: 63, z: -2 }, max: { x: 2, y: 66, z: 2 }, dimension: 'overworld' }],
            permits: () => permits });
        assert.notEqual(G.penGateRefusal(bot, gateBlock(world)), null);
        permits = [{ name: 'chicken_pen', until: Date.now() + 60000 }];
        assert.equal(G.penGateRefusal(bot, gateBlock(world)), null);
    });

    test('pensNear: the unsaved pen as an area the item reflex keeps out of', () => {
        const world = penWorld();
        const bot = penBot(world, { x: 0, y: 64, z: -6 }, 6);
        const list = G.pensNear(bot, 8);
        assert.equal(list.length, 1);
        assert.equal(K.isKeepOutArea(list[0]), true);
        assert.deepEqual(K.keepOutAreas(list, bot.entity.position, 'overworld').length, 1);
    });
});
