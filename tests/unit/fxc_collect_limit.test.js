// v0.1.4.8, fix round, X11 (DEFECTS_WORLD_0148.md): `!collectBlocks("oak_fence", 3)` broke 4 posts and said
// "Collected 4 oak_fence." Never break more blocks than asked: the loop of skills.collectBlock ends when
// the gain reached the number, or when the number of broken blocks reached it. The broken blocks are seen
// in the block updates of mineflayer (also those that the path search of the collect plugin broke on its
// way), and that path search may not break another block of the asked types than the one it collects.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { Vec3 } from 'vec3';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { makeBot, registry } from './stb_fake_bot.test.js';

register('../helpers/mcdata_hooks.js', import.meta.url);
const mcdata = await loadSrc('src/utils/mcdata.js');
const skills = await loadSrc('src/agent/library/skills.js');
mcdata.__setMcdataForTests(registry);

// 5 fence posts in a row on the grass, like the world test w57 part B.
function fenceScene() {
    const world = createBlockWorld().flatGround(63);
    for (let x = 2; x <= 6; x++) world.set(x, 64, 3, 'oak_fence');
    const bot = makeBot({ world });
    const listeners = new Map();
    bot.on = (event, fn) => { listeners.set(event, [...(listeners.get(event) ?? []), fn]); };
    bot.removeListener = (event, fn) => { listeners.set(event, (listeners.get(event) ?? []).filter((f) => f !== fn)); };
    bot.listenerCount = (event) => (listeners.get(event) ?? []).length;
    // like mineflayer: a changed block emits blockUpdate(oldBlock, newBlock)
    bot.setBlock = (p, name) => {
        const old = bot.blockAt(p);
        world.set(p.x, p.y, p.z, name);
        const now = bot.blockAt(p);
        for (const fn of listeners.get('blockUpdate') ?? []) fn(old, now);
        return old;
    };
    bot.breakAt = (p, drop = 1) => {
        const old = bot.setBlock(p, 'air');
        if (drop > 0) bot.inventory.add(old.name, drop);
        bot.broken.push(`${p.x},${p.y},${p.z}`);
    };
    bot.broken = [];
    bot.collectBlock = { movements: { exclusionAreasBreak: [] }, async collect(block) { bot.breakAt(block.position); } };
    return { world, bot };
}

const fencesLeft = (world) => [2, 3, 4, 5, 6].filter((x) => world.get(x, 64, 3) === 'oak_fence').length;

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

describe('X11: collectBlock never breaks more blocks than asked', () => {
    test('the path search breaks a second post on the way: 3 asked, 3 broken, "Collected 3 oak_fence."', async () => {
        const { world, bot } = fenceScene();
        let first = true;
        bot.collectBlock.collect = async (block) => {
            bot.breakAt(block.position);
            if (first) { // the walk to the dropped item dug through the next post, as seen in w57
                first = false;
                bot.breakAt(block.position.offset(1, 0, 0));
            }
        };
        assert.equal(await skills.collectBlock(bot, 'oak_fence', 3), true);
        assert.equal(bot.broken.length, 3, JSON.stringify(bot.broken));
        assert.equal(fencesLeft(world), 2);
        assert.equal(bot.output, 'Collected 3 oak_fence.\n');
    });

    test('the gain reached the number (more drops than blocks): the loop ends', async () => {
        const { world, bot } = fenceScene();
        bot.collectBlock.collect = async (block) => { bot.breakAt(block.position, 2); };
        await skills.collectBlock(bot, 'oak_fence', 3);
        assert.equal(bot.broken.length, 2, 'the second block brought the gain to 4');
        assert.equal(fencesLeft(world), 3);
    });

    test('without block updates (an old fake bot) the own count of broken blocks still caps the loop', async () => {
        const { world, bot } = fenceScene();
        bot.on = () => {};
        bot.removeListener = () => {};
        await skills.collectBlock(bot, 'oak_fence', 3);
        assert.equal(fencesLeft(world), 2);
        assert.equal(bot.output, 'Collected 3 oak_fence.\n');
    });

    test('a block that the server puts back (a refused dig) does not count as broken', async () => {
        const { world, bot } = fenceScene();
        let first = true;
        bot.collectBlock.collect = async (block) => {
            const p = block.position;
            if (first) {
                first = false;
                bot.breakAt(p, 0); // broken on the client ...
                bot.setBlock(p, 'oak_fence'); // ... and the server sends the post back
                bot.breakAt(p.offset(1, 0, 0)); // the next post breaks for real
                return;
            }
            bot.breakAt(p);
        };
        await skills.collectBlock(bot, 'oak_fence', 2);
        assert.equal(5 - fencesLeft(world), 2, 'two posts are gone: the one put back did not count');
    });

    test('while it runs, the path search of the collect plugin may break only the post it collects', async () => {
        const { bot } = fenceScene();
        const seen = [];
        bot.collectBlock.collect = async (block) => {
            const rules = bot.collectBlock.movements.exclusionAreasBreak;
            const cost = (p) => rules.reduce((sum, rule) => sum + rule(bot.blockAt(p)), 0);
            seen.push({ target: cost(block.position), other: cost(block.position.offset(1, 0, 0)), grass: cost(new Vec3(0, 63, 0)) });
            bot.breakAt(block.position);
        };
        await skills.collectBlock(bot, 'oak_fence', 2);
        assert.deepEqual(seen, [{ target: 0, other: 100, grass: 0 }, { target: 0, other: 100, grass: 0 }]);
        assert.deepEqual(bot.collectBlock.movements.exclusionAreasBreak, [], 'the rule is gone afterwards');
        assert.equal(bot.listenerCount('blockUpdate'), 0, 'the listener is gone afterwards');
    });

    test('the listener and the rule are gone also when the collect throws', async () => {
        const { bot } = fenceScene();
        bot.tool.equipForBlock = async () => { throw new Error('no tool'); };
        await assert.rejects(skills.collectBlock(bot, 'oak_fence', 2), /no tool/);
        assert.deepEqual(bot.collectBlock.movements.exclusionAreasBreak, []);
        assert.equal(bot.listenerCount('blockUpdate'), 0);
    });

    test('20 asked with 5 there: all 5, then "No more oak_fence nearby to collect." as before', async () => {
        const { world, bot } = fenceScene();
        await skills.collectBlock(bot, 'oak_fence', 20);
        assert.equal(fencesLeft(world), 0);
        assert.ok(bot.output.includes('No more oak_fence nearby to collect.'), bot.output);
        assert.ok(bot.output.endsWith('Collected 5 oak_fence.\n'), bot.output);
    });
});
