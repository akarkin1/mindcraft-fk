// Engineer E1 of v0.1.4.11, part W, spec W4 and W5 in src/agent/library/skills.js: goToSurface means the open sky
// (out of a building through its door, up from a mine through the mining pack, else the nearest open sky within
// 16 blocks, never the roof, never digging), and the texts of giveToPlayer. Signatures and return values stay.
// Two fakes: the bot of stb_fake_bot.test.js (the path finder arrives at once) and the bot of the home pack
// (home_fake_bot.test.js) with its house and a door that opens and closes.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { makeBot, registry } from './stb_fake_bot.test.js';
import { makeWorld, makeFakeBot, buildHouse } from './home_fake_bot.test.js';

register('../helpers/mcdata_hooks.js', import.meta.url);
const mcdata = await loadSrc('src/utils/mcdata.js');
const skills = await loadSrc('src/agent/library/skills.js');
const TEXTS = await loadSrc('src/agent/library/skill_texts.js');
mcdata.__setMcdataForTests(registry);

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

const feet = (bot) => [Math.floor(bot.entity.position.x), Math.floor(bot.entity.position.y + 0.01), Math.floor(bot.entity.position.z)];
const digs = (bot) => bot.calls.filter((c) => c[0] === 'dig').length;

describe('W4: the texts, word for word', () => {
    test('the four texts', () => {
        const T = TEXTS.SURFACE_TEXTS;
        assert.equal(T.already(), 'I am under the open sky already.');
        assert.equal(T.door('door', { x: 10, y: 67, z: 52 }, { x: 8.5, y: 67, z: 50.5 }), 'I went out through the door at (10, 67, 52) and stand under the open sky at (8, 67, 50).');
        assert.equal(T.climbed({ x: 9, y: 67, z: 52 }), 'I climbed to the open sky at (9, 67, 52).');
        assert.equal(T.noWay({ x: 10, y: 48, z: -26 }), 'I find no way to the open sky from (10, 48, -26).');
    });

    test('the signature: goToSurface(bot) still works, ctx is optional', () => {
        assert.equal(skills.goToSurface.length, 1);
    });
});

describe('W4: goToSurface on the fake bot', () => {
    test('under the open sky: the text, true, no walk', async () => {
        const bot = makeBot();
        assert.equal(await skills.goToSurface(bot), true);
        assert.equal(bot.output, 'I am under the open sky already.\n');
        assert.ok(!bot.calls.some((c) => c[0] === 'goto'));
    });

    test('under a roof without walls: to the nearest open sky on the ground, never onto the roof', async () => {
        const world = createBlockWorld().flatGround(63);
        for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) world.set(x, 67, z, 'oak_planks');
        const bot = makeBot({ world, pos: [0.5, 64, 0.5] });
        assert.equal(await skills.goToSurface(bot), true);
        const [x, y, z] = feet(bot);
        assert.equal(y, 64, 'on the ground, not on the roof at 68');
        assert.ok(Math.max(Math.abs(x), Math.abs(z)) === 3, `next to the roof: ${feet(bot)}`);
        assert.equal(bot.output, `I climbed to the open sky at (${x}, 64, ${z}).\n`);
        assert.equal(digs(bot), 0);
    });

    test('deep under the ground with no open sky within 16 blocks: the text of no way, false, nothing dug', async () => {
        const world = createBlockWorld().flatGround(63, 'grass_block', 'stone');
        world.set(0, 40, 0, 'air');
        world.set(0, 41, 0, 'air');
        const bot = makeBot({ world, pos: [0.5, 40, 0.5] });
        assert.equal(await skills.goToSurface(bot), false);
        assert.equal(bot.output, 'I find no way to the open sky from (0, 40, 0).\n');
        assert.deepEqual(feet(bot), [0, 40, 0]);
        assert.equal(digs(bot), 0);
    });

    test('in a mine: the way out of the mining pack through ctx, then the text of the climb', async () => {
        const world = createBlockWorld().flatGround(63, 'grass_block', 'stone');
        world.set(0, 40, 0, 'air');
        world.set(0, 41, 0, 'air');
        const bot = makeBot({ world, pos: [0.5, 40, 0.5] });
        const calls = [];
        const ctx = {
            whereAmI: () => ({ underground: true, mine: { name: 'mine', tunnel: null, level: 41 } }),
            mining: { climbToSurface: async (b, c) => { calls.push([b === bot, c === ctx]); bot.entity.position = new Vec3(5.5, 64, 5.5); return { ok: true, reason: null, text: 'I am up.' }; } },
        };
        assert.equal(await skills.goToSurface(bot, ctx), true);
        assert.deepEqual(calls, [[true, true]]);
        assert.equal(bot.output, 'I climbed to the open sky at (5, 64, 5).\n');
    });

    test('in a mine without the mining pack: no call, the text of no way', async () => {
        const world = createBlockWorld().flatGround(63, 'grass_block', 'stone');
        world.set(0, 40, 0, 'air');
        world.set(0, 41, 0, 'air');
        const bot = makeBot({ world, pos: [0.5, 40, 0.5] });
        const ctx = { whereAmI: () => ({ underground: true, mine: { name: 'mine', tunnel: null, level: 41 } }), mining: null };
        assert.equal(await skills.goToSurface(bot, ctx), false);
        assert.equal(bot.output, 'I find no way to the open sky from (0, 40, 0).\n');
    });

    test('inside the house: out through its door, the door closed behind, under the open sky on the ground', async () => {
        const world = makeWorld();
        buildHouse(world);
        const bot = makeFakeBot({ world, pos: [4.5, 64, 4.5] });
        bot.output = '';
        bot.modes = { exists: () => false, isOn: () => false, pause() {}, unpause() {} };
        assert.equal(await skills.goToSurface(bot), true);
        const [x, y, z] = feet(bot);
        assert.equal(y, 64, 'never on the roof');
        assert.ok(z >= 8, `outside the house: ${feet(bot)}`);
        assert.match(bot.output, /^I went out through the door at \(4, 64, 7\) and stand under the open sky at \(-?\d+, 64, -?\d+\)\.\n$/);
        assert.equal(bot.output, `I went out through the door at (4, 64, 7) and stand under the open sky at (${x}, 64, ${z}).\n`);
        assert.equal(world.propsAt(4, 64, 7).open, false, 'the door is closed after');
    });
});

describe('W5: the texts of giveToPlayer, word for word', () => {
    test('all taken, some on the ground', () => {
        assert.equal(TEXTS.GIVE_TEXTS.given(44, 'wheat', 'MartyByrde2'), 'Gave 44 wheat to MartyByrde2.');
        assert.equal(TEXTS.GIVE_TEXTS.partly('MartyByrde2', 40, 44, 'wheat', { x: 8.4, y: 63, z: 28.7 }),
            'MartyByrde2 took 40 of 44 wheat; 4 lie on the ground at (8, 63, 28).');
        assert.equal(TEXTS.GIVE_TEXTS.partly('MartyByrde2', 43, 44, 'wheat', { x: 8, y: 63, z: 28 }),
            'MartyByrde2 took 43 of 44 wheat; 1 lies on the ground at (8, 63, 28).');
    });

    test('the signature stays', () => {
        assert.equal(skills.giveToPlayer.length, 3);
    });
});

// The bot of stb_fake_bot.test.js with events: it stays where it is (4 blocks from the player), tosses the stack,
// and the player picks up `taken` of it 100 ms later; the rest lies at (6, 64, 1).
function giveScene(taken) {
    const bot = makeBot();
    bot.gotoImpl = () => {};
    const events = new EventEmitter();
    bot.on = events.on.bind(events);
    bot.once = events.once.bind(events);
    bot.removeListener = events.removeListener.bind(events);
    bot.inventory.put('wheat', 44);
    const player = { id: 7, name: 'player', type: 'player', username: 'MartyByrde2', position: new Vec3(4.5, 64, 0.5) };
    bot.entities[7] = player;
    bot.players.MartyByrde2 = { username: 'MartyByrde2', entity: player };
    const toss = bot.toss;
    bot.toss = async (...args) => {
        await toss(...args);
        setTimeout(() => {
            if (taken < 44)
                bot.entities[8] = { id: 8, name: 'item', type: 'object', position: new Vec3(6.2, 64, 1.7), getDroppedItem: () => ({ name: 'wheat', count: 44 - taken }) };
            if (taken > 0)
                events.emit('playerCollect', player, { id: 9, name: 'item', getDroppedItem: () => ({ name: 'wheat', count: taken }) });
        }, 100);
    };
    return { bot, events };
}

describe('W5: giveToPlayer counts what the player took', () => {
    test('all 44 taken: "Gave 44 wheat to MartyByrde2.", true, no listener left', async () => {
        const { bot, events } = giveScene(44);
        assert.equal(await skills.giveToPlayer(bot, 'wheat', 'MartyByrde2', 44), true);
        assert.ok(bot.output.endsWith('Gave 44 wheat to MartyByrde2.\n'), bot.output);
        assert.equal(events.listenerCount('playerCollect'), 0);
    });

    test('40 of 44 taken: the rest and where it lies, true (some were given)', async () => {
        const { bot, events } = giveScene(40);
        assert.equal(await skills.giveToPlayer(bot, 'wheat', 'MartyByrde2', 44), true);
        assert.ok(bot.output.endsWith('MartyByrde2 took 40 of 44 wheat; 4 lie on the ground at (6, 64, 1).\n'), bot.output);
        assert.equal(events.listenerCount('playerCollect'), 0);
    });

    test('none taken: 0 of 44, false', async () => {
        const { bot } = giveScene(0);
        assert.equal(await skills.giveToPlayer(bot, 'wheat', 'MartyByrde2', 44), false);
        assert.ok(bot.output.endsWith('MartyByrde2 took 0 of 44 wheat; 44 lie on the ground at (6, 64, 1).\n'), bot.output);
    });
});
